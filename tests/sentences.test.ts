import { describe, expect, it } from 'vitest';

import { splitAtBoundary, takeCompleteSentences } from '../src/announcer/sentences.js';

describe('takeCompleteSentences', () => {
  it('returns whole sentences and keeps the unterminated tail', () => {
    const { chunks, rest } = takeCompleteSentences('One small step. For a man, one giant le');
    expect(chunks).toEqual(['One small step.']);
    expect(rest).toBe(' For a man, one giant le');
  });

  it('does not split decimals', () => {
    const { chunks } = takeCompleteSentences('Pi is 3.14 and that is that. ');
    expect(chunks).toEqual(['Pi is 3.14 and that is that.']);
  });

  it('does not split common abbreviations', () => {
    const { chunks } = takeCompleteSentences('Use a flag, e.g. --json, to get output. Next one. ');
    expect(chunks).toEqual(['Use a flag, e.g. --json, to get output.', 'Next one.']);
  });

  it('keeps an initial with a full stop inside the sentence', () => {
    const { chunks } = takeCompleteSentences('J. Smith wrote this. It is short. ');
    expect(chunks).toEqual(['J. Smith wrote this.', 'It is short.']);
  });

  it('treats a newline as a boundary', () => {
    const { chunks } = takeCompleteSentences('First line\nSecond line\n');
    expect(chunks).toEqual(['First line', 'Second line']);
  });

  it('keeps closing quotes with the sentence', () => {
    const { chunks } = takeCompleteSentences('He said "stop." Then he left. ');
    expect(chunks).toEqual(['He said "stop."', 'Then he left.']);
  });

  it('waits for more input at the very end', () => {
    const { chunks, rest } = takeCompleteSentences('Complete. Partial');
    expect(chunks).toEqual(['Complete.']);
    expect(rest).toBe(' Partial');
  });

  it('handles Korean sentence terminators', () => {
    const { chunks } = takeCompleteSentences('첫 문장입니다. 두 번째 문장입니다. ');
    expect(chunks).toEqual(['첫 문장입니다.', '두 번째 문장입니다.']);
  });
});

describe('splitAtBoundary', () => {
  it('leaves short text alone', () => {
    expect(splitAtBoundary('short text', 40)).toEqual({ head: '', tail: 'short text' });
  });

  it('cuts at the last word boundary before the cap', () => {
    const text = 'alpha beta gamma delta epsilon';
    const { head, tail } = splitAtBoundary(text, 18);
    expect(head).toBe('alpha beta gamma');
    expect(tail).toBe('delta epsilon');
  });

  it('refuses to cut when there is no boundary', () => {
    const text = 'a'.repeat(120);
    expect(splitAtBoundary(text, 40)).toEqual({ head: '', tail: text });
  });
});
