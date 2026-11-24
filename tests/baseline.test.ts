import { describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { compareReports, findingKey } from '../src/baseline.js';
import type { Finding } from '../src/rules.js';
import { snapshot } from './helpers/fixtures.js';

const finding = (rule: Finding['rule'], evidence: Finding['evidence'] = {}): Finding => ({
  rule, evidence, severity: 'error', title: rule, message: rule, suggestion: 'Fix it',
});
const report = () => audit(snapshot({ events: [] }));

describe('baseline comparison', () => {
  it('classifies unchanged, added and resolved findings by rule and target', () => {
    const original = finding('token-storm', { region: '#answer', windowStartMs: 100 });
    const again = finding('token-storm', { region: '#answer', windowStartMs: 500 });
    const removed = finding('silent-abort', { answerId: 'a1' });
    const added = finding('token-storm', { region: '#status' });
    const before = { ...report(), findings: [original, removed] };
    const after = { ...report(), findings: [again, added] };
    const result = compareReports(before, after);
    expect(result.unchanged).toEqual([again]);
    expect(result.added).toEqual([added]);
    expect(result.resolved).toEqual([removed]);
    expect(findingKey(original)).toBe(findingKey(again));
  });
  it('reports zero new findings for an identical audit', () => {
    const before = report();
    expect(compareReports(before, before).added).toEqual([]);
  });
  it('rejects mismatched simulation profiles', () => {
    expect(() => compareReports(report(), audit(snapshot({ events: [] }), { profile: 'voiceover-like' })))
      .toThrow(/Cannot compare profiles/);
  });
  it('compares the requested measurements and preserves missing rates', () => {
    const before = report();
    const after = { ...before, metrics: { ...before.metrics, utterances: before.metrics.utterances + 2 } };
    const result = compareReports(before, after);
    expect(result.metrics.find(item => item.label === 'announcements')?.delta).toBe(2);
    expect(result.metrics.find(item => item.label === 'words/min')?.delta).toBeNull();
    expect(result.metrics.map(item => item.label)).toEqual(['announcements', 'words/min', 'updates/s', 'duplicate', 'assertive', 'partial']);
  });
});
