import type { AuditReport } from './audit.js';
import type { Finding, Metrics } from './rules.js';

/** Classification of findings by rule and stable target, plus metric changes. */
export interface BaselineComparison {
  profile: AuditReport['profile'];
  added: Finding[];
  resolved: Finding[];
  unchanged: Finding[];
  metrics: MetricDelta[];
}
export interface MetricDelta {
  label: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
}

const METRICS: Array<[string, keyof Metrics]> = [
  ['announcements', 'utterances'],
  ['words/min', 'wordsPerMinute'],
  ['updates/s', 'peakUpdatesPerSecond'],
  ['duplicate', 'duplicates'],
  ['assertive', 'assertive'],
  ['partial', 'partials'],
];

/** Evidence uses a region label or answer id when a rule has a specific target.
 * Other rules apply to the complete recording. Ignore timestamps, counts and
 * examples because they change between runs for the same rule and target. */
export function findingKey(finding: Finding): string {
  const evidence = finding.evidence;
  const target = typeof evidence.region === 'string' ? evidence.region
    : typeof evidence.answerId === 'string' ? evidence.answerId
    : 'recording';
  return JSON.stringify([finding.rule, target]);
}

export function compareReports(baseline: AuditReport, current: AuditReport): BaselineComparison {
  if (baseline.profile !== current.profile) {
    throw new Error(`Cannot compare profiles: baseline ${baseline.profile}, current ${current.profile}.`);
  }
  const before = new Map(baseline.findings.map(finding => [findingKey(finding), finding]));
  const after = new Map(current.findings.map(finding => [findingKey(finding), finding]));
  const added = [...after].filter(([key]) => !before.has(key)).map(([, value]) => value);
  const resolved = [...before].filter(([key]) => !after.has(key)).map(([, value]) => value);
  const unchanged = [...after].filter(([key]) => before.has(key)).map(([, value]) => value);
  const metrics = METRICS.map(([label, key]) => {
    const oldValue = baseline.metrics[key];
    const newValue = current.metrics[key];
    const previous = typeof oldValue === 'number' && Number.isFinite(oldValue) ? oldValue : null;
    const next = typeof newValue === 'number' && Number.isFinite(newValue) ? newValue : null;
    return { label, baseline: previous, current: next, delta: previous === null || next === null ? null : next - previous };
  });
  return { profile: current.profile, added, resolved, unchanged, metrics };
}
