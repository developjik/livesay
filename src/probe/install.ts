/**
 * Node side of the probe: load the browser bundle, inject it before page
 * scripts, and read the recording back. Typed against a minimal structural
 * interface so any Playwright-compatible page object works.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProbeSnapshot } from '../types.js';

type PageFunction<T> = string | ((argument?: unknown) => T | Promise<T>);

export interface MinimalPage {
  addInitScript(script: { content: string }): Promise<unknown>;
  evaluate<T>(pageFunction: PageFunction<T>, argument?: unknown): Promise<T>;
  waitForFunction(
    pageFunction: PageFunction<unknown>,
    argument?: unknown,
    options?: { timeout?: number; polling?: number | 'raf' },
  ): Promise<unknown>;
}

const here = (): string => dirname(fileURLToPath(import.meta.url));

/** Read the IIFE probe bundle built by `npm run build`. */
export function probeRuntimeSource(): string {
  const candidates = [
    resolve(here(), 'runtime.bundle.js'),
    resolve(here(), '../../dist/probe/runtime.bundle.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(
    'livesay: probe bundle not found. Run "npm run build" (or install the published package) before auditing.',
  );
}

/** Inject the probe so it runs before the page's own scripts. */
export async function installProbe(page: MinimalPage): Promise<void> {
  await page.addInitScript({ content: probeRuntimeSource() });
}

/**
 * Passed as a *function*, not a string: Playwright evaluates a string as an
 * expression, so an arrow-function string resolves truthy on the first poll and
 * the audit captures nothing.
 */
export const probeReady = (): boolean =>
  Boolean(window.__livesayProbe) &&
  document.documentElement?.getAttribute('data-livesay-probe') === 'ready';

export const answerEnded = (): boolean => {
  const probe = window.__livesayProbe;
  if (!probe) return false;
  return probe.snapshot().answers.some((answer) => answer.outcome !== 'running');
};

export const readSnapshot = (): string =>
  JSON.stringify(window.__livesayProbe ? window.__livesayProbe.snapshot() : null);

/** Wait until the page reports a finished/aborted/errored answer. */
export async function waitForAnswer(
  page: MinimalPage,
  options: { timeoutMs?: number } = {},
): Promise<'marked' | 'timeout'> {
  try {
    await page.waitForFunction(answerEnded, undefined, {
      timeout: options.timeoutMs ?? 20_000,
      polling: 100,
    });
    return 'marked';
  } catch {
    return 'timeout';
  }
}

/** Read and parse the probe's snapshot. */
export async function readProbeSnapshot(page: MinimalPage): Promise<ProbeSnapshot> {
  const raw = await page.evaluate<string>(readSnapshot);
  const parsed = JSON.parse(raw) as ProbeSnapshot | null;
  if (!parsed) throw new Error('livesay: probe did not attach to the page (window.__livesayProbe missing).');
  return parsed;
}
