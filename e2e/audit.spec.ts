import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { runCli, startDemo, type DemoServer } from './helpers.js';

let demo: DemoServer;
let workdir: string;

test.beforeAll(async () => {
  demo = await startDemo();
  workdir = await mkdtemp(join(tmpdir(), 'livesay-e2e-'));
});

test.afterAll(async () => {
  await demo.close();
});

test('flags the naive page and exits non-zero', async () => {
  const json = join(workdir, 'bad.json');
  const result = await runCli(['audit', `${demo.url}/bad.html`, '--json', json]);

  expect(result.code, result.stderr || result.stdout).toBe(1);
  expect(result.stdout).toContain('FAIL');

  const report = JSON.parse(await readFile(json, 'utf8')) as {
    verdict: string;
    findings: Array<{ rule: string; severity: string }>;
    metrics: { peakUpdatesPerSecond: number; completionAnnounced: boolean | null };
  };

  expect(report.verdict).toBe('fail');
  const rules = report.findings.map((finding) => finding.rule);
  expect(rules).toContain('token-storm');
  expect(rules).toContain('silent-completion');
  expect(rules).toContain('assertive-abuse');
  expect(report.metrics.peakUpdatesPerSecond).toBeGreaterThanOrEqual(10);
  expect(report.metrics.completionAnnounced).toBe(false);
});

test('passes the corrected page inside a speech budget', async () => {
  const json = join(workdir, 'good.json');
  const result = await runCli([
    'audit',
    `${demo.url}/good.html`,
    '--budget',
    'announcements<8,no-partial,no-duplicate,no-silent',
    '--json',
    json,
  ]);

  expect(result.code, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain('PASS');

  const report = JSON.parse(await readFile(json, 'utf8')) as {
    verdict: string;
    findings: unknown[];
    metrics: { utterances: number; completionAnnounced: boolean | null; peakUpdatesPerSecond: number };
    budget: { passed: boolean };
  };

  expect(report.verdict).toBe('pass');
  expect(report.findings).toEqual([]);
  expect(report.budget.passed).toBe(true);
  expect(report.metrics.utterances).toBeLessThanOrEqual(8);
  expect(report.metrics.completionAnnounced).toBe(true);
  expect(report.metrics.peakUpdatesPerSecond).toBeLessThanOrEqual(4);
});

test('fails a budget that the page cannot meet', async () => {
  const result = await runCli(['audit', `${demo.url}/good.html`, '--budget', 'announcements<2']);
  expect(result.code, result.stderr || result.stdout).toBe(1);
  expect(result.stdout).toContain('budget failed');
});

test('compares all three screen-reader profiles over one recording', async () => {
  const result = await runCli(['audit', `${demo.url}/bad.html`, '--profile', 'all']);
  expect(result.code, result.stderr || result.stdout).toBe(1);
  expect(result.stdout).toMatch(/nvda-like\s+\d+/);
  expect(result.stdout).toMatch(/voiceover-like\s+\d+/);
  expect(result.stdout).toMatch(/spec-strict\s+\d+/);
});

test('writes a self-contained HTML transcript', async () => {
  const html = join(workdir, 'report.html');
  const result = await runCli(['audit', `${demo.url}/bad.html`, '--html', html, '--quiet']);
  expect(result.stderr, result.stdout).not.toContain('livesay:');
  const contents = await readFile(html, 'utf8');
  expect(contents).toContain('Utterance timeline');
  expect(contents).toContain('token-storm');
  expect(contents).toContain('<style>');
});

test('keeps all profile JSON on stdout clean and HTML includes every report', async ({ page }) => {
  const html = join(workdir, 'all-profiles.html');
  const result = await runCli(['audit', `${demo.url}/bad.html`, '--profile', 'all', '--json', '-', '--html', html]);
  expect(result.code, result.stderr).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.schema).toBe('livesay.profiles/v1');
  expect(report.reports.map((entry: { profile: string }) => entry.profile)).toEqual(['nvda-like', 'voiceover-like', 'spec-strict']);
  expect(report.reports.every((entry: { findings: unknown[] }) => entry.findings.length > 0)).toBe(true);
  await page.goto(`file://${html}`);
  await expect(page.locator('iframe')).toHaveCount(3);
  await expect(page.frameLocator('iframe').nth(1).getByRole('heading', { name: /Utterance timeline/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/livesay-all-profiles.png', fullPage: true });
});

test('drains large all-profile JSON to a pipe before exiting', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<div aria-live="polite" id="status"></div><script>setTimeout(async()=>{window.__livesayProbe?.mark('start');for(let i=0;i<150;i++){document.querySelector('#status').textContent='notice '+i+' '+('sample content '.repeat(30));await new Promise(r=>setTimeout(r,10));}window.__livesayProbe?.mark('done');},200);</script>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const args = ['dist/cli.js', 'audit', `http://127.0.0.1:${address.port}`, '--profile', 'all', '--json', '-', '--quiet'];
    const result = await new Promise<{code:number|null;stdout:string;stderr:string}>(resolve => {
      const child = spawn(process.execPath, args, { stdio:['ignore','pipe','pipe'] });
      let stdout = '', stderr = '';
      // Keep the reader paused long enough for the large JSON write to block.
      child.stdout.pause();
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.stdout.once('readable', () => setTimeout(() => {
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stdout.resume();
      }, 300));
      child.once('close', code => resolve({code,stdout,stderr}));
    });
    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(64 * 1024);
    expect(JSON.parse(result.stdout).reports).toHaveLength(3);
    const closedPipeCode = await new Promise<number|null>(resolve => {
      const child = spawn(process.execPath, args, { stdio:['ignore','pipe','pipe'] });
      child.stderr.resume();
      child.stdout.once('data', () => child.stdout.destroy());
      child.once('close', resolve);
    });
    expect(closedPipeCode).toBe(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
