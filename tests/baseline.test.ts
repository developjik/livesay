import { describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { baselineFailed, compareReports, readAuditReports } from '../src/baseline.js';
import { renderComparisonHtml, renderHtml, renderJson, reportsFailed } from '../src/report.js';
import { snapshot, tokenBurst, region } from './helpers/fixtures.js';

const report = (label = 'div#answer') => audit(snapshot({ events: tokenBurst(100, 8, 30, region({ label })) }));

describe('baseline regression gate', () => {
  it('keeps existing failures listed but does not fail them again', () => {
    const before = report(), after = report();
    after.baseline = compareReports(readAuditReports(JSON.parse(renderJson(before)))[0]!, after);
    expect(after.baseline.added).toEqual([]);
    expect(after.baseline.unchanged).toHaveLength(before.findings.length);
    expect(after.verdict).toBe('fail');
    expect(reportsFailed([after], true)).toBe(false);
    expect(reportsFailed([before])).toBe(true);
    expect(renderHtml(after)).toContain('Unchanged');
  });
  it('identifies a new region without counting the existing region again', () => {
    const before = report();
    const after = audit(snapshot({ events: [...tokenBurst(100, 8), ...tokenBurst(2000, 8, 30, region({ id: 'r2', label: 'div#other' }))] }));
    const comparison = compareReports(before, after);
    expect(comparison.added.map(item => item.target)).toEqual(['region:div#other']);
    expect(comparison.unchanged.map(item => item.target)).toEqual(['region:div#answer']);
    expect(baselineFailed(comparison)).toBe(true);
  });
  it('uses labels rather than unstable probe ids and ignores times', () => {
    const before = report();
    const after = audit(snapshot({ events: tokenBurst(5000, 8, 30, region({ id: 'r99' })) }));
    expect(compareReports(before, after).added).toHaveLength(0);
  });
  it('lists resolutions, metric deltas, and escapes HTML input', () => {
    const before = report('<img src=x onerror=alert(1)>');
    const after = audit(snapshot({ events: [] }));
    const comparison = compareReports(before, after);
    expect(comparison.resolved).toHaveLength(1);
    expect(comparison.metrics.find(row => row.metric === 'updates/s')?.delta).toBe(-8);
    expect(comparison.metrics.find(row => row.metric === 'words/min')?.delta).toBe(null);
    const html = renderComparisonHtml(comparison);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
  it('rejects incompatible profiles, versions, configuration, and truncated findings', () => {
    const before = report();
    expect(() => compareReports(before, { ...report(), profile: 'spec-strict' })).toThrow(/profile/);
    expect(() => compareReports(before, { ...report(), tool: { name: 'livesay', version: 'future' } })).toThrow(/version/);
    expect(() => compareReports(before, { ...report(), options: { ...before.options, stormWindowMs: 42 } })).toThrow(/options/);
    before.options.maxFindings = 1;
    expect(() => compareReports(before, before)).toThrow(/truncated/);
  });
  it('counts severity escalation as new and leaves warnings opt-in', () => {
    const after = report(), before = structuredClone(after);
    before.findings[0]!.severity = 'warn';
    expect(baselineFailed(compareReports(before, after))).toBe(true);
    after.findings[0]!.severity = 'warn';
    const clean = audit(snapshot({ events: [] }));
    const comparison = compareReports(clean, after);
    expect(baselineFailed(comparison)).toBe(false);
    expect(baselineFailed(comparison, true)).toBe(true);
  });
  it('gates only newly failed matching budget checks', () => {
    const before = audit(snapshot({ events: [] }), { budget: 'announcements<1' });
    const after = audit(snapshot({ events: tokenBurst(100, 8) }), { budget: 'announcements<1' });
    expect(compareReports(before, after).newBudgetFailures).toHaveLength(1);
    expect(compareReports(after, after).newBudgetFailures).toHaveLength(0);
    expect(() => compareReports(report(), after)).toThrow(/budget/);
  });
  it('rejects malformed input and duplicate profiles', () => {
    for (const value of [null, {}, [], { schema: 'livesay.profiles/v1', reports: [] }, { ...report(), metrics: {} }, { ...report(), findings: [{}] }]) {
      expect(() => readAuditReports(value)).toThrow();
    }
    expect(() => readAuditReports({ schema: 'livesay.profiles/v1', reports: [report(), report()] })).toThrow(/duplicate/);
  });
});

it('persists non-default detector regexes and rejects changed patterns', () => {
  const recording = snapshot({ events: [] });
  const before = audit(recording, { rules: { completionPattern: /custom-complete/i } });
  const saved = readAuditReports(JSON.parse(renderJson(before)))[0]!;
  expect(compareReports(saved, before).added).toHaveLength(0);
  expect(() => compareReports(saved, audit(recording))).toThrow(/options/);
});
it('does not coerce finding enums or accept inconsistent budget results', () => {
  const valid = report();
  expect(() => readAuditReports({ ...valid, findings: [{ ...valid.findings[0], severity: ['error'] }] })).toThrow();
  expect(() => readAuditReports({ ...valid, findings: [{ ...valid.findings[0], rule: ['token-storm'] }] })).toThrow();
  expect(() => readAuditReports({ ...valid, budget: { spec: 'no-errors', passed: false, checks: [] } })).toThrow();
  expect(() => readAuditReports({ ...valid, budget: { spec: 'no-errors', passed: false, checks: [{ expectation: 'no-errors', ok: true }] } })).toThrow();
});

it('matches custom patterns after recursive JSON key sorting', () => {
  const before = audit(snapshot({ events: [] }), { rules: { completionPattern: /custom/i } });
  const saved = JSON.parse(renderJson(before));
  saved.rulePatterns.completionPattern = { flags: 'i', source: 'custom' };
  expect(compareReports(readAuditReports(saved)[0]!, before).added).toHaveLength(0);
});
