import { describe, expect, it } from 'vitest';

import { countWords, endsMidSentence, formatClock, isStrictPrefix, normalizeForCompare, truncate } from '../src/text.js';

describe('countWords', () => {
  it('counts latin words', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('counts a Hangul run as one word', () => {
    expect(countWords('안녕하세요 여러분')).toBe(2);
  });

  it('ignores punctuation-only runs', () => {
    expect(countWords('hello — world')).toBe(2);
  });

  it('is zero for whitespace', () => {
    expect(countWords('   ')).toBe(0);
  });
});

describe('normalizeForCompare', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normalizeForCompare('Hello,   World!')).toBe(normalizeForCompare('hello world'));
  });
});

describe('isStrictPrefix', () => {
  it('is true only for a real prefix', () => {
    expect(isStrictPrefix('The answer', 'The answer is 42')).toBe(true);
    expect(isStrictPrefix('The answer', 'The answer')).toBe(false);
    expect(isStrictPrefix('abc', 'abcdef')).toBe(true);
    expect(isStrictPrefix('ab', 'abcdef')).toBe(false);
  });
});

describe('endsMidSentence', () => {
  it('detects a sentence that stops without terminal punctuation', () => {
    expect(endsMidSentence('The answer is')).toBe(true);
    expect(endsMidSentence('The answer is ready.')).toBe(false);
    expect(endsMidSentence('Wait…')).toBe(false);
  });
});

describe('formatClock', () => {
  it('formats milliseconds as m:ss.mmm', () => {
    expect(formatClock(0)).toBe('0:00.000');
    expect(formatClock(1234)).toBe('0:01.234');
    expect(formatClock(65_500)).toBe('1:05.500');
  });
});

describe('truncate', () => {
  it('keeps short text and shortens long text', () => {
    expect(truncate('short')).toBe('short');
    expect(truncate('x'.repeat(40), 10)).toHaveLength(10);
  });
});
