import { expect, test } from '@playwright/test';

import { startDemo, type DemoServer } from './helpers.js';

let demo: DemoServer;

test.beforeAll(async () => {
  demo = await startDemo();
});

test.afterAll(async () => {
  await demo.close();
});

interface Snapshot {
  events: Array<{
    type: string;
    t: number;
    seq: number;
    text?: string;
    priority?: string;
    phase?: string;
    answerId?: string;
    region?: { label: string; politeness?: string };
  }>;
  answers: Array<{ id: string; endedAt: number | null; outcome: string }>;
  regions: Array<{ label: string }>;
}

const announcementsAfter = (snapshot: Snapshot, outcome: string): Snapshot['events'] => {
  const mark = [...snapshot.events]
    .reverse()
    .find((event) => event.type === 'mark' && event.phase === outcome);
  if (!mark) return [];
  return snapshot.events.filter(
    (event) =>
      event.seq > mark.seq &&
      (event.type === 'notify' || event.type === 'region-added' || event.type === 'region-updated'),
  );
};

async function readSnapshot(page: import('@playwright/test').Page): Promise<Snapshot> {
  await page.waitForFunction(
    'Boolean(window.__livesayProbe) && window.__livesayProbe.snapshot().answers.some((answer) => answer.outcome !== "running")',
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);
  return JSON.parse(await page.evaluate<string>('JSON.stringify(window.__livesayProbe.snapshot())')) as Snapshot;
}

test('the corrected page keeps the answer out of a live region', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/good.html`);
  const snapshot = await readSnapshot(page);

  const answerIsLive = await page.evaluate<string>(
    'document.getElementById("answer").hasAttribute("aria-live")',
  );
  expect(answerIsLive).toBe(false);
  expect(snapshot.regions.some((region) => region.label === 'article#answer')).toBe(false);
  expect(await page.evaluate<string>('document.getElementById("answer").getAttribute("aria-busy")')).toBe('false');
});

test('the corrected page announces a bounded set of messages and a completion', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/good.html`);
  const snapshot = await readSnapshot(page);

  const announcements = snapshot.events.filter(
    (event) => event.type === 'notify' || event.type === 'region-added' || event.type === 'region-updated',
  );
  expect(announcements.length).toBeGreaterThan(2);
  expect(announcements.length).toBeLessThan(10);

  const after = announcementsAfter(snapshot, 'done');
  expect(after.length).toBeGreaterThan(0);
  expect(after.some((event) => /complete/i.test(event.text ?? ''))).toBe(true);
});

test('the naive page fails silently when the stream errors', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/bad.html`);
  await page.click('#fail');
  await page.waitForFunction(
    'window.__livesayProbe.snapshot().answers.some((answer) => answer.outcome === "error")',
    undefined,
    { timeout: 20_000 },
  );

  const snapshot = JSON.parse(await page.evaluate<string>('JSON.stringify(window.__livesayProbe.snapshot())')) as Snapshot;
  expect(announcementsAfter(snapshot, 'error')).toHaveLength(0);
});

test('the corrected page announces the error once, assertively', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/good.html`);
  await page.click('#fail');
  await page.waitForFunction(
    'window.__livesayProbe.snapshot().answers.some((answer) => answer.outcome === "error")',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(600);

  const snapshot = JSON.parse(await page.evaluate<string>('JSON.stringify(window.__livesayProbe.snapshot())')) as Snapshot;
  const after = announcementsAfter(snapshot, 'error');
  expect(after.length).toBeGreaterThan(0);
  const urgent = after.find(
    (event) => event.priority === 'high' || event.region?.politeness === 'assertive',
  );
  expect(urgent).toBeDefined();
  expect(urgent?.text).toMatch(/failed/i);
});

test('the naive page writes every token into a live region and never signals the end', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/bad.html`);
  const snapshot = await readSnapshot(page);

  const answerUpdates = snapshot.events.filter(
    (event) => event.type === 'region-updated' && event.region?.label === 'p#answer',
  );
  expect(answerUpdates.length).toBeGreaterThan(40);

  expect(announcementsAfter(snapshot, 'done')).toHaveLength(0);
});
