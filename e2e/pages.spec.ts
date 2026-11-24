import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let out: string | undefined;
let server: Server | undefined;
let base: string;
test.beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'livesay-pages-'));
  execFileSync(process.execPath, ['scripts/build-pages.mjs', out]);
  server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    if (!path.startsWith('/livesay/')) { res.writeHead(404); res.end(); return; }
    const file = path.slice('/livesay/'.length) || 'index.html';
    try {
      const bytes = await readFile(join(out!, file));
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server port');
  base = `http://127.0.0.1:${address.port}/livesay/`;
});
test.afterAll(async () => {
  try {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  } finally {
    if (out) await rm(out, { recursive: true, force: true });
  }
});
test('Pages assets, both links and measurements work under a project path', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(response.url()); });
  await page.goto(base);
  expect(await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily)).toContain('Segoe UI');
  for (const href of ['./bad.html', './good.html']) {
    await page.locator(`a.run[href="${href}"]`).click();
    await expect(page).toHaveURL(new URL(href, base).href);
    await expect(page.locator('#answer')).toBeVisible();
    await page.locator('a.brand').click();
    await expect(page).toHaveURL(base);
  }
  await page.locator('#run-both').click();
  await expect(page.locator('#score-bad')).toContainText('completion no', { timeout: 35000 });
  await expect(page.locator('#score-good')).toContainText('completion yes');
  expect(errors).toEqual([]);
});
