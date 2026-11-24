import type { AuditReport } from './audit.js';
import { DEFAULT_RULE_OPTIONS } from './rules.js';
import type { Finding } from './rules.js';
import { PROFILE_NAMES } from './simulate.js';

export interface FindingChange { key: string; rule: string; target: string; severity: Finding['severity']; finding: Finding }
export interface MetricDelta { metric: string; before: number | null; after: number | null; delta: number | null }
export interface BaselineComparison {
  schema: 'livesay.baseline/v1';
  profile: AuditReport['profile'];
  baselineUrl: string;
  currentUrl: string;
  added: FindingChange[];
  resolved: FindingChange[];
  unchanged: FindingChange[];
  metrics: MetricDelta[];
  newBudgetFailures: string[];
}

/** Region labels and explicit answer ids survive probe-local region numbering. */
function targetOf(finding: Finding): string {
  if (typeof finding.evidence.region === 'string') return `region:${finding.evidence.region}`;
  if (typeof finding.evidence.answerId === 'string') return `answer:${finding.evidence.answerId}`;
  if (finding.rule === 'token-storm') return 'ariaNotify';
  return 'recording';
}
function changes(report: AuditReport): Map<string, FindingChange> {
  const map = new Map<string, FindingChange>();
  for (const finding of report.findings) {
    const target = targetOf(finding);
    const key = JSON.stringify([finding.rule, target]);
    const previous = map.get(key);
    if (!previous || finding.severity === 'error') map.set(key, { key, rule: finding.rule, target, severity: finding.severity, finding });
  }
  return map;
}

const wireOptions = (report: AuditReport): string => {
  const options = { ...report.options } as Record<string, unknown>;
  for (const key of ['completionPattern', 'abortPattern'] as const) {
    const pattern = report.options[key];
    options[key] = report.rulePatterns?.[key] ?? (pattern instanceof RegExp ? { source: pattern.source, flags: pattern.flags } : { source: DEFAULT_RULE_OPTIONS[key].source, flags: DEFAULT_RULE_OPTIONS[key].flags });
  }
  return JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
};

export function compareReports(before: AuditReport, after: AuditReport): BaselineComparison {
  if (before.profile !== after.profile) throw new Error(`baseline profile mismatch: ${before.profile} vs ${after.profile}`);
  if (before.tool.version !== after.tool.version || before.target.probeVersion !== after.target.probeVersion) throw new Error('baseline tool/probe version mismatch; record a fresh baseline');
  // RegExp serializes to {} in existing JSON reports. Compare the wire options,
  // so both freshly captured reports and their persisted forms use one contract.
  if (wireOptions(before) !== wireOptions(after)) throw new Error('baseline rule options mismatch; use the same audit configuration');
  if ((before.budget?.spec ?? '') !== (after.budget?.spec ?? '')) throw new Error('baseline budget mismatch; use the same budget');
  for (const report of [before, after]) {
    if (report.findings.length >= report.options.maxFindings) throw new Error('baseline findings may be truncated by maxFindings; increase the limit before comparing');
  }
  const old = changes(before), current = changes(after);
  const added: FindingChange[] = [], unchanged: FindingChange[] = [], resolved: FindingChange[] = [];
  for (const [key, change] of current) {
    const previous = old.get(key);
    if (!previous || (previous.severity === 'warn' && change.severity === 'error')) added.push(change);
    else unchanged.push(change);
  }
  for (const [key, change] of old) if (!current.has(key)) resolved.push(change);
  const fields = [
    ['announcements', 'utterances'], ['words/min', 'wordsPerMinute'], ['updates/s', 'peakUpdatesPerSecond'],
    ['dup', 'duplicates'], ['assertive', 'assertive'], ['partial', 'partials'],
  ] as const;
  const metrics = fields.map(([metric, field]) => {
    const a = before.metrics[field], b = after.metrics[field];
    return { metric, before: a, after: b, delta: a === null || b === null ? null : b - a };
  });
  const oldFailures = new Set(before.budget?.checks.filter(check => !check.ok).map(check => check.expectation));
  const newBudgetFailures = after.budget?.checks.filter(check => !check.ok && !oldFailures.has(check.expectation)).map(check => check.expectation) ?? [];
  return { schema: 'livesay.baseline/v1', profile: after.profile, baselineUrl: before.target.url, currentUrl: after.target.url, added, resolved, unchanged, metrics, newBudgetFailures };
}

export function baselineFailed(comparison: BaselineComparison, strict = false): boolean {
  return comparison.newBudgetFailures.length > 0 || comparison.added.some(change => change.severity === 'error' || strict);
}

/** Validate the wire fields used by comparison, never treat malformed JSON as a pass. */
export function readAuditReports(value: unknown): AuditReport[] {
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item);
  const numeric = (item: unknown): boolean => typeof item === 'number' && Number.isFinite(item) && item >= 0;
  const raw = record(value) && value.schema === 'livesay.profiles/v1' ? value.reports : [value];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('baseline must contain audit reports');
  const seen = new Set<string>();
  for (const item of raw) {
    if (!record(item) || !record(item.tool) || item.tool.name !== 'livesay' || typeof item.tool.version !== 'string' ||
      typeof item.profile !== 'string' || !PROFILE_NAMES.includes(item.profile as AuditReport['profile']) || seen.has(item.profile) ||
      !record(item.target) || typeof item.target.url !== 'string' || typeof item.target.probeVersion !== 'string' ||
      !record(item.options) || !['stormWindowMs', 'stormMinUpdates', 'duplicateWindowMs', 'assertiveLimit', 'completionGraceMs', 'partialMinChars', 'maxFindings'].every(key => numeric((item.options as Record<string, unknown>)[key])) || item.options.maxFindings === 0 ||
      !record(item.metrics) || !Array.isArray(item.findings) ||
      !['utterances', 'peakUpdatesPerSecond', 'duplicates', 'assertive', 'partials'].every(key => numeric((item.metrics as Record<string, unknown>)[key])) ||
      !(item.metrics.wordsPerMinute === null || numeric(item.metrics.wordsPerMinute)) ||
      !item.findings.every(finding => record(finding) && ['token-storm','silent-completion','silent-abort','assertive-abuse','duplicate-announcement','partial-announcement'].includes(finding.rule as string) && typeof finding.title === 'string' && typeof finding.message === 'string' && typeof finding.suggestion === 'string' && ['error', 'warn'].includes(finding.severity as string) && record(finding.evidence))) {
      throw new Error('invalid or duplicate livesay audit report in baseline');
    }
    if (item.budget !== undefined && (!record(item.budget) || typeof item.budget.spec !== 'string' || typeof item.budget.passed !== 'boolean' || !Array.isArray(item.budget.checks) || item.budget.checks.length === 0 || !item.budget.checks.every(check => record(check) && typeof check.ok === 'boolean' && typeof check.expectation === 'string') || item.budget.passed !== item.budget.checks.every(check => (check as Record<string, unknown>).ok))) throw new Error('invalid baseline budget');
    if (item.rulePatterns !== undefined && (!record(item.rulePatterns) || !['completionPattern', 'abortPattern'].every(key => {
      const pattern = (item.rulePatterns as Record<string, unknown>)[key];
      return record(pattern) && typeof pattern.source === 'string' && typeof pattern.flags === 'string';
    }))) throw new Error('invalid baseline rule patterns');
    seen.add(item.profile);
  }
  return raw as AuditReport[];
}
