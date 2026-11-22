/** Small text helpers shared by the simulator, the rules and the reports. */

/**
 * Approximate spoken word count.
 *
 * Latin runs split on whitespace; a run of Hangul/Han/Kana counts as one word
 * (Korean is written with spaces, and counting CJK per character would inflate
 * words-per-minute by an order of magnitude). It is an estimate, and the report
 * says so — but it is the same estimate on both sides of a before/after.
 */
export function countWords(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  let total = 0;
  for (const run of normalized.split(' ')) {
    const cjk = run.match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu);
    const latin = run.match(/[A-Za-z0-9][A-Za-z0-9'’._@/-]*/g);
    const count = (cjk?.length ?? 0) + (latin?.length ?? 0);
    total += count > 0 ? count : 0;
  }
  return total;
}

/** Case-, space- and punctuation-insensitive form used for duplicate detection. */
export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[.,;:!?…'"“”‘’()[\]{}<>·•\-–—]/g, '')
    .trim();
}

/** True when `shorter` is a strict prefix of `longer` and long enough to be word-like. */
export function isStrictPrefix(shorter: string, longer: string): boolean {
  if (!shorter || !longer) return false;
  if (shorter.length < 3) return false;
  return longer.length > shorter.length && longer.startsWith(shorter);
}

/** True when the text stops in the middle of speech rather than at a sentence or clause edge. */
export function endsMidSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  return !/[.!?…。！？:;,\u2014-]$/.test(trimmed);
}

export function truncate(text: string, max = 160): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

/** 0 → `0:00.000`; used in the transcript's time column. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
