import { describe, expect, it } from 'vitest';

import { BudgetError, checkBudget, parseBudget } from '../src/budget.js';
import type { Metrics } from '../src/rules.js';
import type { Finding } from '../src/rules.js';

const metrics = (overrides: Partial<Metrics> = {}): Metrics => ({
  updates: 20,
  silentUpdates: 0,
  peakUpdatesPerSecond: 8,
  candidates: 20,
  utterances: 6,
  words: 90,
  wordsPerMinute: 140,
  durationMs: 30_000,
  partials: 0,
  duplicates: 0,
  assertive: 0,
  interruptions: 0,
  replaced: 0,
  folded: 0,
  deferred: 0,
  completionAnnounced: true,
  answers: 1,
  ...overrides,
});

const error = (rule: Finding['rule']): Finding => ({
  rule,
  severity: 'error',
  title: 'x',
  message: 'x',
  suggestion: 'x',
  evidence: {},
});

describe('parseBudget', () => {
  it('parses numeric and flag terms', () => {
    const terms = parseBudget('announcements<8, words/min<180 ,no-partial');
    expect(terms).toHaveLength(3);
    expect(terms[0]).toMatchObject({ kind: 'numeric', metric: 'utterances', operator: '<', limit: 8 });
    expect(terms[1]).toMatchObject({ kind: 'numeric', metric: 'wordsPerMinute', operator: '<', limit: 180 });
    expect(terms[2]).toMatchObject({ kind: 'flag', flag: 'partial' });
  });

  it('explains an unknown metric', () => {
    expect(() => parseBudget('tokens<100')).toThrow(BudgetError);
    expect(() => parseBudget('tokens<100')).toThrow(/Unknown budget metric/);
  });

  it('rejects an empty budget', () => {
    expect(() => parseBudget('  ' )).toThrow(BudgetError);
  });
});

describe('checkBudget', () => {
  it('passes when everything is inside the budget', () => {
    const result = checkBudget('announcements<8,words/min<180,no-partial,no-silent', metrics(), []);
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(4);
  });

  it('fails a metric over its limit and shows both numbers', () => {
    const result = checkBudget('announcements<8', metrics({ utterances: 47 }), []);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.actual).toBe(47);
    expect(result.checks[0]?.expectation).toBe('announcements < 8');
  });

  it('fails no-silent when completion was never announced', () => {
    const result = checkBudget('no-silent', metrics({ completionAnnounced: false }), []);
    expect(result.passed).toBe(false);
  });

  it('treats an unmarked recording as not measurable rather than failing', () => {
    const result = checkBudget('no-silent', metrics({ completionAnnounced: null }), []);
    expect(result.passed).toBe(true);
    expect(result.checks[0]?.detail).toMatch(/no completion mark/);
  });

  it('fails no-errors when a rule reported an error', () => {
    const result = checkBudget('no-errors', metrics(), [error('token-storm')]);
    expect(result.passed).toBe(false);
  });

  it('supports assertive limits', () => {
    expect(checkBudget('assertive<=1', metrics({ assertive: 2 }), []).passed).toBe(false);
    expect(checkBudget('assertive<=2', metrics({ assertive: 2 }), []).passed).toBe(true);
  });
});
