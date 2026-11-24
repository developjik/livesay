import { describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { PROFILES, PROFILE_NAMES } from '../src/simulate.js';
import { renderJson, renderReportsJson, renderReportsHtml, reportsFailed } from '../src/report.js';
import { regionUpdate, snapshot } from './helpers/fixtures.js';

const recording = snapshot({ events: [0,100,200].map((t,index) => regionUpdate({ t, text: `notice ${index}`, previousText: '', addedText: `notice ${index}` })) });
const reports = PROFILE_NAMES.map(profile => audit(recording, { profile, budget: 'announcements<3' }));

describe('all profile reports', () => {
  it('fails when the first profile passes but other budgets fail', () => {
    expect(reports[0]?.budget?.passed).toBe(true);
    expect(reports.slice(1).some(report => !report.budget?.passed)).toBe(true);
    expect(reportsFailed(reports)).toBe(true);
  });
  it('checks non-primary errors and strict warnings and preserves pass behavior', () => {
    const clean = reports.map(report => ({ ...report, findings: [], budget: undefined }));
    expect(reportsFailed(clean)).toBe(false);
    const warned = clean.map((report,index) => index === 1 ? { ...report, findings: [{ rule: 'partial-announcement', severity: 'warn', message: 'test warning' }] } : report) as typeof reports;
    expect(reportsFailed(warned)).toBe(false);
    expect(reportsFailed(warned, true)).toBe(true);
    const errors = warned.map((report,index) => index === 2 ? { ...report, findings: [{ rule: 'token-storm', severity: 'error', message: 'test error' }] } : report) as typeof reports;
    expect(reportsFailed(errors)).toBe(true);
  });
  it('keeps every profile and failure cause in JSON and HTML', () => {
    const parsed = JSON.parse(renderReportsJson(reports));
    expect(parsed.schema).toBe('livesay.profiles/v1');
    expect(parsed.reports.map((report: { profile: string }) => report.profile)).toEqual(PROFILE_NAMES);
    expect(parsed.reports[1].budget.passed).toBe(false);
    const html = renderReportsHtml(reports);
    for (const profile of PROFILE_NAMES) expect(html).toContain(profile);
    expect(html.match(/<iframe /g)).toHaveLength(Object.keys(PROFILES).length);
    expect(JSON.parse(renderJson(reports[0]!)).profile).toBe(PROFILE_NAMES[0]);
    expect(JSON.parse(renderJson(reports[0]!)).schema).toBeUndefined();
  });
});
