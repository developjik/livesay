/**
 * The one line an app needs in production.
 *
 * `markAnswer()` is a no-op unless the livesay probe is on the page, so the same
 * code path runs in your app and under `livesay audit` — no test-only branches.
 */

import type { AnswerPhase } from '../types.js';

interface ProbeLike {
  mark(phase: AnswerPhase, options?: { id?: string; detail?: string }): void;
}

export function markAnswer(phase: AnswerPhase, options?: { id?: string; detail?: string }): void {
  const probe = (globalThis as { __livesayProbe?: ProbeLike }).__livesayProbe;
  if (!probe) return;
  try {
    probe.mark(phase, options);
  } catch {
    /* reporting must never break the app */
  }
}
