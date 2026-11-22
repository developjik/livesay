/**
 * Drive a URL through Chromium, record what it announces, hand back the
 * snapshot. Everything else (simulation, rules, reports) is pure.
 */

import { installProbe, probeReady, readProbeSnapshot, waitForAnswer, type MinimalPage } from './probe/install.js';
import type { ProbeSnapshot } from './types.js';

export interface CaptureOptions {
  url: string;
  /** Give up waiting for an answer end mark after this long. */
  timeoutMs?: number;
  /** Keep recording this long after the answer ends (trailing announcements). */
  graceMs?: number;
  /** Wait for this selector before starting to wait for the answer end. */
  waitFor?: string;
  headed?: boolean;
  /** Extra settle time after `load`, for framework hydration. */
  settleMs?: number;
  viewport?: { width: number; height: number };
}

export interface CaptureResult {
  snapshot: ProbeSnapshot;
  status: 'marked' | 'timeout';
  elapsedMs: number;
}

export async function capture(options: CaptureOptions): Promise<CaptureResult> {
  const {
    url,
    timeoutMs = 30_000,
    graceMs = 1_200,
    waitFor,
    headed = false,
    settleMs = 250,
    viewport = { width: 1120, height: 780 },
  } = options;

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'livesay: the "playwright" package is required to audit a URL. Install it and run "npx playwright install chromium".',
    );
  }

  const started = Date.now();
  const browser = await chromium.launch({ headless: !headed });
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const minimal = page as unknown as MinimalPage;

    await installProbe(minimal);
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });

    await page
      .waitForFunction(probeReady as unknown as () => boolean, undefined, { timeout: 5_000 })
      .catch(() => undefined);

    if (settleMs > 0) await page.waitForTimeout(settleMs);

    if (waitFor && page.waitForSelector) {
      await page.waitForSelector(waitFor, { timeout: timeoutMs, state: 'visible' });
    }

    const status = await waitForAnswer(minimal, { timeoutMs });
    if (graceMs > 0) await page.waitForTimeout(graceMs);

    const snapshot = await readProbeSnapshot(minimal);
    return { snapshot, status, elapsedMs: Date.now() - started };
  } finally {
    await browser.close();
  }
}
