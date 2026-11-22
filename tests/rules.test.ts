import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RULE_OPTIONS,
  collectMetrics,
  findAssertiveAbuse,
  findDuplicates,
  findPartials,
  findSilentAbort,
  findSilentCompletion,
  findTokenStorm,
  peakInWindow,
} from '../src/rules.js';
import { simulate } from '../src/simulate.js';
import { mark, notify, region, regionUpdate, snapshot, tokenBurst, utterance } from './helpers/fixtures.js';
import type { Utterance } from '../src/types.js';

const options = DEFAULT_RULE_OPTIONS;

const simulation = (utterances: Utterance[]) => ({
  profile: simulate(snapshot({ events: [] })).profile,
  utterances,
  candidates: utterances.length,
  replaced: 0,
  folded: 0,
  deferred: 0,
});

describe('peakInWindow', () => {
  it('finds the densest slice', () => {
    expect(peakInWindow([0, 100, 200, 5000, 5050], 1000)).toEqual({ peak: 3, start: 0 });
  });

  it('is zero for no timestamps', () => {
    expect(peakInWindow([], 1000)).toEqual({ peak: 0, start: 0 });
  });
});

describe('findTokenStorm', () => {
  it('flags a burst of live-region rewrites', () => {
    const findings = findTokenStorm(snapshot({ events: tokenBurst(0, 8, 40) }), options);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('token-storm');
    expect(findings[0]?.evidence.peakUpdates).toBeGreaterThanOrEqual(5);
  });

  it('stays quiet for spaced-out updates', () => {
    const events = Array.from({ length: 6 }, (_, index) =>
      regionUpdate({ t: index * 1500, text: `Sentence number ${index}.` }),
    );
    expect(findTokenStorm(snapshot({ events }), options)).toHaveLength(0);
  });

  it('flags per-token ariaNotify calls', () => {
    const events = Array.from({ length: 6 }, (_, index) => notify(index * 50, `token ${index}`));
    const findings = findTokenStorm(snapshot({ events }), options);
    expect(findings.some((finding) => finding.title.includes('ariaNotify'))).toBe(true);
  });

  it('ignores regions that are aria-live="off"', () => {
    const quiet = region({ politeness: 'off' });
    const events = Array.from({ length: 8 }, (_, index) =>
      regionUpdate({ t: index * 20, text: `shown ${index}`, region: quiet }),
    );
    expect(findTokenStorm(snapshot({ events }), options)).toHaveLength(0);
  });
});

describe('findSilentCompletion', () => {
  it('flags an answer that ends while the backlog of tokens is still being spoken', () => {
    // Regression: speech lags the DOM, so a trailing token lands after the mark.
    // That token is not a completion announcement.
    const recording = snapshot({
      events: [...tokenBurst(0, 10, 30), mark(340, 'done')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 340, outcome: 'done' }],
    });
    const findings = findSilentCompletion(recording, options);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
  });

  it('accepts a distinct completion announcement after the mark', () => {
    const recording = snapshot({
      events: [...tokenBurst(0, 10, 30), mark(340, 'done'), notify(380, 'Answer complete. 40 words.')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 340, outcome: 'done' }],
    });
    expect(findSilentCompletion(recording, options)).toHaveLength(0);
  });

  it('accepts a completion phrase spoken just before the mark', () => {
    const recording = snapshot({
      events: [notify(100, 'Some content'), notify(1900, 'The answer is complete.'), mark(2000, 'done')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 2000, outcome: 'done' }],
    });
    expect(findSilentCompletion(recording, options)).toHaveLength(0);
  });

  it('does not treat a re-announcement of the answer text as completion', () => {
    const recording = snapshot({
      events: [
        regionUpdate({ t: 100, text: 'The answer is a simple sentence.' }),
        mark(500, 'done'),
        regionUpdate({ t: 520, text: 'The answer is a simple sentence.' }),
      ],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 500, outcome: 'done' }],
    });
    expect(findSilentCompletion(recording, options)).toHaveLength(1);
  });

  it('flags an answer that announced nothing at all', () => {
    const recording = snapshot({
      events: [mark(0, 'start'), mark(2000, 'done')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 2000, outcome: 'done' }],
    });
    expect(findSilentCompletion(recording, options)).toHaveLength(1);
  });

  it('does not run on answers without a completion mark', () => {
    const recording = snapshot({
      events: [mark(0, 'start')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: null, outcome: 'running' }],
    });
    expect(findSilentCompletion(recording, options)).toHaveLength(0);
  });
});

describe('findSilentAbort', () => {
  it('flags an abort with no announcement', () => {
    const recording = snapshot({
      events: [mark(0, 'start'), regionUpdate({ t: 100, text: 'partial answer' }), mark(900, 'abort')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 900, outcome: 'abort' }],
    });
    expect(findSilentAbort(recording, options)).toHaveLength(1);
  });

  it('accepts an abort message', () => {
    const recording = snapshot({
      events: [
        mark(0, 'start'),
        regionUpdate({ t: 100, text: 'partial answer' }),
        mark(900, 'abort'),
        notify(950, 'Answer stopped.'),
      ],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 900, outcome: 'abort' }],
    });
    expect(findSilentAbort(recording, options)).toHaveLength(0);
  });
});

describe('findAssertiveAbuse', () => {
  it('flags more than one assertive announcement', () => {
    const findings = findAssertiveAbuse(
      simulation([
        utterance(0, 'Status one', { priority: 'high' }),
        utterance(500, 'Status two', { priority: 'high' }),
      ]),
      options,
    );
    expect(findings[0]?.rule).toBe('assertive-abuse');
    expect(findings[0]?.severity).toBe('error');
  });

  it('warns when a single assertive message interrupted speech', () => {
    const findings = findAssertiveAbuse(
      simulation([
        utterance(0, 'A long sentence is being read aloud.', { interrupted: true }),
        utterance(400, 'Request failed', { priority: 'high' }),
      ]),
      options,
    );
    expect(findings[0]?.severity).toBe('warn');
  });

  it('stays quiet when assertive is used once for an error', () => {
    expect(
      findAssertiveAbuse(simulation([utterance(0, 'ok sentence'), utterance(500, 'failed', { priority: 'high' })]), options),
    ).toHaveLength(0);
  });
});

describe('findDuplicates', () => {
  it('flags the same passage twice inside the window', () => {
    const findings = findDuplicates(
      simulation([utterance(0, 'The answer is exactly forty two words long.'), utterance(2000, 'The answer is exactly forty two words long.')]),
      options,
    );
    expect(findings[0]?.rule).toBe('duplicate-announcement');
  });

  it('ignores repeats far apart and single words', () => {
    expect(
      findDuplicates(simulation([utterance(0, 'Same sentence here.'), utterance(30_000, 'Same sentence here.')]), options),
    ).toHaveLength(0);
    expect(findDuplicates(simulation([utterance(0, 'ok'), utterance(100, 'ok')]), options)).toHaveLength(0);
  });
});

describe('findPartials', () => {
  it('flags a truncated prefix that is spoken again in full', () => {
    const findings = findPartials(
      simulation([
        utterance(0, 'The result is that'),
        utterance(300, 'The result is that the answer is complete.'),
      ]),
      options,
    );
    expect(findings[0]?.rule).toBe('partial-announcement');
  });

  it('does not flag a completed sentence followed by a new one', () => {
    expect(
      findPartials(simulation([utterance(0, 'First sentence.'), utterance(900, 'First sentence. Second one.')]), options),
    ).toHaveLength(0);
  });
});

describe('collectMetrics', () => {
  it('counts updates, speech and completion', () => {
    const recording = snapshot({
      events: [...tokenBurst(0, 12, 25), mark(900, 'done'), notify(950, 'Answer complete.')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 900, outcome: 'done' }],
    });
    const metrics = collectMetrics(recording, simulate(recording, 'nvda-like'), options);
    expect(metrics.updates).toBe(12);
    expect(metrics.peakUpdatesPerSecond).toBeGreaterThan(10);
    expect(metrics.answers).toBe(1);
    expect(metrics.completionAnnounced).toBe(true);
    expect(metrics.wordsPerMinute).toBeGreaterThan(0);
  });
});
