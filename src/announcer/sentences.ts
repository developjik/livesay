/**
 * Sentence boundary detection for streamed text.
 *
 * The whole point of the announcer is to speak complete thoughts, so this is
 * deliberately conservative: it waits for a terminator followed by whitespace,
 * skips decimals, URLs and common abbreviations, and never splits a lone digit
 * or initial. Unpunctuated text is handled by the caller's length cap.
 */

const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', '；', ';']);
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '}', '」', '』', '】', '》']);
const ELLIPSIS = new Set(['…']);

const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'eg',
  'ie',
  'fig',
  'inc',
  'ltd',
  'co',
  'approx',
  'min',
  'max',
  'sec',
  'no',
  'vol',
  'ch',
  'pp',
  'cf',
  'al',
]);

const lastWord = (text: string): string => {
  const match = /([A-Za-z][A-Za-z.]*)$/.exec(text.trimEnd());
  return match?.[1]?.toLowerCase() ?? '';
};

const isAbbreviation = (word: string): boolean => {
  const bare = word.replace(/\.+$/, '').toLowerCase();
  if (!bare) return false;
  if (ABBREVIATIONS.has(bare)) return true;
  // single initial ("J.") or an acronym with dots ("e.g.") is not a sentence end
  return bare.length === 1 || /^([a-z]\.)+[a-z]$/.test(bare);
};

export interface SplitResult {
  chunks: string[];
  rest: string;
}

/**
 * Pull every complete sentence out of `buffer`, leaving an unterminated tail.
 * A newline is a boundary too — streamed markdown emits list items and headings
 * as separate lines and each should be its own announcement.
 */
export function takeCompleteSentences(buffer: string, options: { minChars?: number } = {}): SplitResult {
  const minChars = options.minChars ?? 12;
  const chunks: string[] = [];
  let start = 0;
  let i = 0;

  const push = (from: number, to: number): void => {
    const text = buffer.slice(from, to).trim();
    if (text.length >= minChars) chunks.push(text);
    else if (text) chunks.push(text);
  };

  while (i < buffer.length) {
    const char = buffer[i];
    if (char === undefined) break;

    if (char === '\n') {
      const text = buffer.slice(start, i).trim();
      if (text) chunks.push(text);
      start = i + 1;
      i += 1;
      continue;
    }

    if (!TERMINATORS.has(char)) {
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < buffer.length && CLOSERS.has(buffer[end] ?? '')) end += 1;

    if (end >= buffer.length) break; // the sentence may still be growing
    const next = buffer[end] ?? '';
    if (!/\s/.test(next)) {
      i = end;
      continue;
    }

    if (char === '.' && !ELLIPSIS.has(char)) {
      const word = lastWord(buffer.slice(start, i));
      if (word && isAbbreviation(word)) {
        i = end;
        continue;
      }
      const before = buffer[i - 1] ?? '';
      const after = buffer[i + 1] ?? '';
      if (/\d/.test(before) && /\d/.test(after)) {
        i = end; // 3.14
        continue;
      }
    }

    push(start, end);
    start = end;
    i = end;
  }

  return { chunks, rest: buffer.slice(start) };
}

/**
 * Cut an over-long unpunctuated tail at the last word boundary, so a paragraph
 * without punctuation still gets spoken in human-sized pieces.
 */
export function splitAtBoundary(text: string, maxChars: number): { head: string; tail: string } {
  if (text.length <= maxChars) return { head: '', tail: text };
  const slice = text.slice(0, maxChars);
  const cut = Math.max(
    slice.lastIndexOf(' '),
    slice.lastIndexOf(','),
    slice.lastIndexOf('、'),
    slice.lastIndexOf('，'),
  );
  if (cut <= 0) return { head: '', tail: text };
  return { head: text.slice(0, cut).trim(), tail: text.slice(cut + 1) };
}
