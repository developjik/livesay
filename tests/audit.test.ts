import { describe, expect, it } from 'vitest';

import { audit } from '../src/audit.js';
import { renderHtml, renderJson } from '../src/report.js';
import { mark, notify, region, regionUpdate, snapshot, tokenBurst } from './helpers/fixtures.js';

const naive = () =>
  snapshot({
    events: [
      mark(0, 'start'),
      ...tokenBurst(60, 40, 25),
      regionUpdate({ t: 150, text: 'Searching…', region: region({ id: 'r2', politeness: 'assertive', atomic: true }) }),
      mark(1100, 'done'),
    ],
    answers: [{ id: 'a1', startedAt: 0, endedAt: 1100, outcome: 'done' }],
    regions: [region(), region({ id: 'r2', politeness: 'assertive', atomic: true })],
  });

const corrected = () =>
  snapshot({
    events: [
      mark(0, 'start'),
      notify(50, 'Searching the project notes…'),
      notify(400, 'A streaming answer arrives one token at a time.'),
      notify(1100, 'Most chat interfaces write every token into a live region.'),
      mark(2000, 'done'),
      notify(2040, 'Answer complete. 42 words.'),
    ],
    answers: [{ id: 'a1', startedAt: 0, endedAt: 2000, outcome: 'done' }],
    regions: [],
  });

describe('audit', () => {
  it('fails the naive recording with the expected rules', () => {
    const report = audit(naive());
    expect(report.verdict).toBe('fail');
    const rules = new Set(report.findings.map((finding) => finding.rule));
    expect(rules.has('token-storm')).toBe(true);
    expect(rules.has('silent-completion')).toBe(true);
    expect(report.metrics.peakUpdatesPerSecond).toBeGreaterThanOrEqual(20);
  });

  it('passes a corrected recording and marks completion announced', () => {
    const report = audit(corrected());
    expect(report.verdict).toBe('pass');
    expect(report.metrics.completionAnnounced).toBe(true);
    expect(report.metrics.utterances).toBe(4);
  });

  it('applies the requested profile', () => {
    const report = audit(naive(), { profile: 'voiceover-like' });
    expect(report.profile).toBe('voiceover-like');
    expect(report.profileTagline).toMatch(/queues/);
  });

  it('runs a budget and fails the verdict when it is exceeded', () => {
    const report = audit(corrected(), { budget: 'announcements<3' });
    expect(report.budget?.passed).toBe(false);
    expect(report.verdict).toBe('fail');
  });

  it('keeps the recording when no answer was marked', () => {
    const report = audit(
      snapshot({ events: [regionUpdate({ t: 100, text: 'unmarked page announcement' })] }),
    );
    expect(report.metrics.completionAnnounced).toBeNull();
    expect(report.findings.some((finding) => finding.rule === 'silent-completion')).toBe(false);
  });

  it('summarises each answer', () => {
    const report = audit(corrected());
    expect(report.answers[0]).toMatchObject({ id: 'a1', outcome: 'done', completionAnnounced: true });
    expect(report.answers[0]?.durationMs).toBe(2000);
  });

  it('serialises to JSON that parses back', () => {
    const report = audit(naive());
    const parsed = JSON.parse(renderJson(report)) as typeof report;
    expect(parsed.tool.name).toBe('livesay');
    expect(parsed.findings.length).toBe(report.findings.length);
  });
});

describe('renderHtml', () => {
  it('renders a self-contained transcript with the verdict and the utterances', () => {
    const html = renderHtml(audit(naive()));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('FAIL');
    expect(html).toContain('Utterance timeline');
    expect(html).toContain('<style>');
    expect(html).not.toContain('<script src=');
  });

  it('escapes page text instead of injecting it', () => {
    const hostile = snapshot({
      events: [regionUpdate({ t: 10, text: '<img src=x onerror=alert(1)>' })],
    });
    const html = renderHtml(audit(hostile));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('lists findings with their rule id and fix', () => {
    const html = renderHtml(audit(naive()));
    expect(html).toContain('token-storm');
    expect(html).toContain('<b>Fix →</b>');
  });
});
