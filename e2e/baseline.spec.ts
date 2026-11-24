import { mkdtemp, readFile, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { audit } from '../src/audit.js';
import { region, snapshot, tokenBurst } from '../tests/helpers/fixtures.js';
import { runCli, startDemo } from './helpers.js';

test('baseline CLI compares live captures and isolated new findings, with readable HTML', async ({ page }) => {
  const demo = await startDemo();
  const dir = await mkdtemp(join(tmpdir(), 'livesay-baseline-'));
  try {
    const baseline = join(dir, 'baseline.json');
    const first = await runCli(['audit', `${demo.url}/bad.html`, '--json', baseline, '--quiet']);
    expect(first.code, first.stderr).toBe(1);
    const same = await runCli(['audit', `${demo.url}/bad.html`, '--baseline', baseline, '--json', '-', '--quiet']);
    expect(same.code, same.stderr).toBe(0);
    const current = JSON.parse(same.stdout);
    expect(current.baseline.added).toHaveLength(0);
    expect(current.baseline.unchanged.length).toBeGreaterThan(0);
    expect(current.findings.length).toBeGreaterThan(0);

    const before = audit(snapshot({ events: tokenBurst(100, 8) }));
    const after = audit(snapshot({ events: [...tokenBurst(100, 8), ...tokenBurst(3000, 8, 30, region({ id: 'r2', label: 'div#new-status' }))] }));
    const a = join(dir, 'a.json'), b = join(dir, 'b.json'), html = join(dir, 'compare.html');
    await writeFile(a, JSON.stringify(before));
    await writeFile(b, JSON.stringify(after));
    const added = await runCli(['compare', a, b, '--json', '--html', html]);
    expect(added.code, added.stderr).toBe(1);
    const comparison = JSON.parse(added.stdout);
    expect(comparison.added.map((item: { target: string }) => item.target)).toEqual(['region:div#new-status']);
    expect(comparison.unchanged).toHaveLength(1);
    await page.goto(`file://${html}`);
    await expect(page.getByRole('heading', { name: 'New (1)' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'updates/s', exact: true })).toBeVisible();
    await page.screenshot({ path: join(dir, 'baseline-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(dir, 'baseline-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const noChange = await runCli(['compare', b, b, '--json']);
    expect(noChange.code, noChange.stderr).toBe(0);
    const resolved = await runCli(['compare', b, a, '--json']);
    expect(JSON.parse(resolved.stdout).resolved).toHaveLength(1);
    await writeFile(b, JSON.stringify({ ...after, profile: 'spec-strict' }));
    const mismatch = await runCli(['compare', a, b, '--json']);
    expect(mismatch.code).toBe(2);
    expect(mismatch.stderr).toContain('profile');
    const overwrite = await runCli(['compare', a, a, '--html', a]);
    expect(overwrite.code).toBe(2);
    const alias = join(dir, 'hardlink.json');
    await link(a, alias);
    expect((await runCli(['compare', a, a, '--json', alias])).code).toBe(2);
    expect(JSON.parse(await readFile(a, 'utf8')).tool.name).toBe('livesay');
  } finally { await demo.close(); }
});
