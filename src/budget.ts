/**
 * A speech budget: the part of an audit you can put in CI.
 *
 *   livesay audit http://localhost:3000 --budget "announcements<8,words/min<180,no-partial"
 *
 * Every key is measured against the simulated utterance timeline, so the number
 * in the budget is "what a listener would hear", not "what the DOM did".
 */

import type { Metrics } from './rules.js';
import type { Finding } from './rules.js';

export interface BudgetCheck {
  key: string;
  /** Human expectation, e.g. `announcements < 8`. */
  expectation: string;
  /** Measured value, `null` when the metric could not be measured. */
  actual: number | boolean | null;
  ok: boolean;
  detail?: string;
}

export interface BudgetResult {
  spec: string;
  passed: boolean;
  checks: BudgetCheck[];
}

type Operator = '<' | '<=' | '>' | '>=' | '=';

interface NumericTerm {
  kind: 'numeric';
  key: string;
  metric: 'utterances' | 'words' | 'wordsPerMinute' | 'peakUpdatesPerSecond' | 'assertive' | 'partials' | 'duplicates';
  operator: Operator;
  limit: number;
}

interface FlagTerm {
  kind: 'flag';
  key: string;
  flag: 'partial' | 'duplicate' | 'silent' | 'errors' | 'warnings';
}

type Term = NumericTerm | FlagTerm;

const NUMERIC_KEYS: Record<string, NumericTerm['metric']> = {
  announcements: 'utterances',
  announcement: 'utterances',
  utterances: 'utterances',
  words: 'words',
  'words/min': 'wordsPerMinute',
  'words-per-minute': 'wordsPerMinute',
  wpm: 'wordsPerMinute',
  'updates/s': 'peakUpdatesPerSecond',
  'updates/sec': 'peakUpdatesPerSecond',
  'updates-per-second': 'peakUpdatesPerSecond',
  updates: 'peakUpdatesPerSecond',
  assertive: 'assertive',
  partials: 'partials',
  duplicates: 'duplicates',
};

const FLAGS: Record<string, FlagTerm['flag']> = {
  'no-partial': 'partial',
  'no-partials': 'partial',
  'no-partial-announcement': 'partial',
  'no-duplicate': 'duplicate',
  'no-duplicates': 'duplicate',
  'no-duplicate-announcement': 'duplicate',
  'no-silent': 'silent',
  'no-silence': 'silent',
  'no-errors': 'errors',
  'no-warnings': 'warnings',
};

export class BudgetError extends Error {}

const OPERATORS: Operator[] = ['<=', '>=', '<', '>', '='];

export function parseBudget(spec: string): Term[] {
  const terms: Term[] = [];

  for (const raw of spec.split(',')) {
    const item = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (!item) continue;

    const flag = FLAGS[item];
    if (flag) {
      terms.push({ kind: 'flag', key: item, flag });
      continue;
    }

    const operator = OPERATORS.find((candidate) => item.includes(candidate));
    if (!operator) {
      throw new BudgetError(
        `Cannot parse budget term "${item}". Use e.g. "announcements<8", "words/min<180", "assertive<=1", "no-partial".`,
      );
    }

    const [rawKey, rawLimit] = item.split(operator);
    const key = (rawKey ?? '').trim();
    const metric = NUMERIC_KEYS[key];
    if (!metric) {
      throw new BudgetError(
        `Unknown budget metric "${key}". Known: ${Object.keys(NUMERIC_KEYS).join(', ')}, ${Object.keys(FLAGS).join(', ')}.`,
      );
    }

    const limit = Number(rawLimit);
    if (!Number.isFinite(limit)) {
      throw new BudgetError(`Budget limit for "${key}" is not a number: "${rawLimit}".`);
    }

    terms.push({ kind: 'numeric', key, metric, operator, limit });
  }

  if (terms.length === 0) throw new BudgetError('Budget is empty.');
  return terms;
}

function compare(actual: number, operator: Operator, limit: number): boolean {
  switch (operator) {
    case '<':
      return actual < limit;
    case '<=':
      return actual <= limit;
    case '>':
      return actual > limit;
    case '>=':
      return actual >= limit;
    case '=':
      return actual === limit;
    default:
      return false;
  }
}

export function checkBudget(
  spec: string,
  metrics: Metrics,
  findings: Finding[],
): BudgetResult {
  const terms = parseBudget(spec);
  const checks: BudgetCheck[] = terms.map((term) => {
    if (term.kind === 'numeric') {
      const actual = metrics[term.metric];
      if (actual === null || actual === undefined) {
        return {
          key: term.key,
          expectation: `${term.key} ${term.operator} ${term.limit}`,
          actual: null,
          ok: true,
          detail: 'not measurable in this recording',
        };
      }
      return {
        key: term.key,
        expectation: `${term.key} ${term.operator} ${term.limit}`,
        actual,
        ok: compare(actual, term.operator, term.limit),
      };
    }

    const errors = findings.filter((finding) => finding.severity === 'error').length;
    const warnings = findings.filter((finding) => finding.severity === 'warn').length;

    switch (term.flag) {
      case 'partial':
        return {
          key: term.key,
          expectation: 'no partial announcements',
          actual: metrics.partials,
          ok: metrics.partials === 0,
        };
      case 'duplicate':
        return {
          key: term.key,
          expectation: 'no duplicate announcements',
          actual: metrics.duplicates,
          ok: metrics.duplicates === 0,
        };
      case 'silent':
        return {
          key: term.key,
          expectation: 'completion is announced',
          actual: metrics.completionAnnounced,
          ok: metrics.completionAnnounced !== false,
          ...(metrics.completionAnnounced === null ? { detail: 'no completion mark in this recording' } : {}),
        };
      case 'errors':
        return { key: term.key, expectation: 'no errors', actual: errors, ok: errors === 0 };
      case 'warnings':
      default:
        return { key: term.key, expectation: 'no warnings', actual: warnings, ok: warnings === 0 };
    }
  });

  return { spec, passed: checks.every((check) => check.ok), checks };
}
