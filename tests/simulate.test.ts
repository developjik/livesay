import { describe, expect, it } from 'vitest';

import { PROFILES, simulate, type ProfileName } from '../src/simulate.js';
import { mark, notify, region, regionUpdate, snapshot, tokenBurst } from './helpers/fixtures.js';

describe('simulate', () => {
  it('collapses a token burst into a few utterances on a coalescing profile', () => {
    const recording = snapshot({ events: [...tokenBurst(1000, 30)] });
    const nvda = simulate(recording, 'nvda-like');
    expect(nvda.candidates).toBe(30);
    expect(nvda.utterances.length).toBeLessThan(5);
    expect(nvda.replaced).toBeGreaterThan(20);
  });

  it('queues every update on a non-coalescing profile', () => {
    const recording = snapshot({ events: [...tokenBurst(1000, 8, 60)] });
    const voiceover = simulate(recording, 'voiceover-like');
    expect(voiceover.utterances.length).toBeGreaterThan(4);
    expect(voiceover.profile.name).toBe('voiceover-like');
  });

  it('lets an assertive announcement interrupt polite speech', () => {
    const alert = region({ id: 'r2', label: 'div#alert', politeness: 'assertive', atomic: true });
    const recording = snapshot({
      events: [
        regionUpdate({ t: 100, text: 'A rather long sentence that takes a while to speak.', atomic: true } as never),
        regionUpdate({ t: 150, text: 'Request failed', region: alert }),
      ],
    });
    const result = simulate(recording, 'nvda-like');
    const interrupted = result.utterances.filter((utterance) => utterance.interrupted);
    expect(interrupted.length).toBe(1);
    expect(result.utterances.at(-1)?.priority).toBe('high');
  });

  it('defers announcements while a region is aria-busy', () => {
    const busy = region({ busy: true });
    const recording = snapshot({
      events: [regionUpdate({ t: 100, text: 'still writing', region: busy })],
    });
    const result = simulate(recording, 'nvda-like');
    expect(result.utterances).toHaveLength(0);
    expect(result.deferred).toBe(1);
  });

  it('never speaks a region that is aria-live="off"', () => {
    const recording = snapshot({
      events: [regionUpdate({ t: 100, text: 'quiet text', region: region({ politeness: 'off' }) })],
    });
    expect(simulate(recording).utterances).toHaveLength(0);
  });

  it('folds rapid ariaNotify calls but keeps spaced ones', () => {
    const rapid = snapshot({ events: [notify(100, 'one'), notify(200, 'two'), notify(300, 'three')] });
    const rapidResult = simulate(rapid, 'nvda-like');
    expect(rapidResult.utterances.length).toBeLessThan(3);
    expect(rapidResult.folded).toBeGreaterThan(0);

    const spaced = snapshot({ events: [notify(100, 'one'), notify(2000, 'two')] });
    expect(simulate(spaced, 'nvda-like').utterances).toHaveLength(2);
  });

  it('records a completion announcement that arrives after the mark', () => {
    const recording = snapshot({
      events: [mark(0, 'start'), mark(1000, 'done'), notify(1010, 'Answer complete.')],
      answers: [{ id: 'a1', startedAt: 0, endedAt: 1000, outcome: 'done' }],
    });
    const result = simulate(recording, 'nvda-like');
    expect(result.utterances.at(-1)?.t).toBeGreaterThanOrEqual(1000);
  });

  it('exposes all three profiles under stable names', () => {
    const names = Object.keys(PROFILES) as ProfileName[];
    expect(names).toEqual(['nvda-like', 'voiceover-like', 'spec-strict']);
  });
});
