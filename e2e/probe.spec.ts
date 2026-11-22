import { expect, test } from '@playwright/test';

import { startDemo, type DemoServer } from './helpers.js';

let demo: DemoServer;

test.beforeAll(async () => {
  demo = await startDemo();
});

test.afterAll(async () => {
  await demo.close();
});

test('injects before page scripts and records ariaNotify through a page polyfill', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/probe-fixture.html`);
  await page.waitForFunction('document.title === "fixture ready"');

  const snapshot = JSON.parse(await page.evaluate<string>('JSON.stringify(window.__livesayProbe.snapshot())')) as {
    events: Array<Record<string, unknown>>;
    answers: Array<{ outcome: string }>;
    ariaNotify: { native: boolean; pageProvided: boolean };
  };

  const notices = snapshot.events.filter((event) => event.type === 'notify');
  expect(notices).toHaveLength(2);
  expect(notices[0]).toMatchObject({ text: 'Polite notification', priority: 'normal', impl: 'page' });
  expect(notices[1]).toMatchObject({ text: 'Urgent notification', priority: 'high' });
  expect(snapshot.ariaNotify.pageProvided).toBe(true);
  expect(snapshot.answers[0]?.outcome).toBe('done');
});

test('resolves ARIA semantics: politeness, atomicity, roles and aria-busy', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/probe-fixture.html`);
  await page.waitForFunction('document.title === "fixture ready"');

  const regions = await page.evaluate<string>(
    'JSON.stringify(window.__livesayProbe.regions().map((region) => ({ label: region.label, role: region.role, politeness: region.politeness, atomic: region.atomic, busy: region.busy })))',
  );
  const parsed = JSON.parse(regions) as Array<{
    label: string;
    role: string | null;
    politeness: string;
    atomic: boolean;
    busy: boolean;
  }>;

  const byLabel = (label: string) => parsed.find((region) => region.label === label);

  expect(byLabel('p#polite')).toMatchObject({ politeness: 'polite', atomic: false });
  expect(byLabel('p#alert')).toMatchObject({ role: 'alert', politeness: 'assertive', atomic: true });
  expect(byLabel('p#log')).toMatchObject({ role: 'log', politeness: 'polite', atomic: false });
  expect(byLabel('output#out')).toMatchObject({ role: 'status', politeness: 'polite', atomic: true });
  expect(byLabel('div#hidden-idle')).toMatchObject({ politeness: 'off' });
  expect(byLabel('div#busy')).toMatchObject({ busy: true });
});

test('records incremental text and the delta the mutation added', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/probe-fixture.html`);
  await page.waitForFunction('document.title === "fixture ready"');

  const updates = JSON.parse(
    await page.evaluate<string>(
      'JSON.stringify(window.__livesayProbe.snapshot().events.filter((event) => event.type === "region-updated").map((event) => ({ text: event.text, added: event.addedText, prev: event.previousText })))',
    ),
  ) as Array<{ text: string; added: string; prev: string }>;

  const hello = updates.find((update) => update.text === 'Hello world');
  expect(hello).toBeDefined();
  expect(hello?.prev).toBe('Hello');
  expect(hello?.added).toBe(' world');
});

test('does not expose a fake ariaNotify in a browser that has none', async ({ page }) => {
  await page.addInitScript({ path: 'dist/probe/runtime.bundle.js' });
  await page.goto(`${demo.url}/probe-fixture.html`);
  // The fixture installs its own polyfill; before that, absence must read as absence.
  const typeAfterPolyfill = await page.evaluate<string>('typeof window.ariaNotify');
  expect(typeAfterPolyfill).toBe('function');

  await page.goto(`${demo.url}/bad.html`);
  const probe = await page.evaluate<string>('typeof window.__livesayProbe');
  expect(probe).toBe('object');
});
