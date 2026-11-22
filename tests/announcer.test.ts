import { describe, expect, it } from 'vitest';

import { createStreamingAnnouncer } from '../src/announcer/core.js';
import { createMemorySink } from '../src/announcer/sink.js';
import { createClock, trackAnnouncements } from './helpers/clock.js';

function makeAnnouncer(minIntervalMs = 600) {
  const clock = createClock();
  const { sink, calls } = trackAnnouncements();
  const announcer = createStreamingAnnouncer({
    sink: sink as never,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    minIntervalMs,
  });
  return { announcer, calls, clock };
}

describe('createStreamingAnnouncer', () => {
  it('speaks the first complete sentence immediately', () => {
    const { announcer, calls } = makeAnnouncer();
    announcer.push('A streaming answer arrives ');
    expect(calls).toHaveLength(0);
    announcer.push('one token at a time. ');
    expect(calls).toEqual([{ text: 'A streaming answer arrives one token at a time.', priority: 'normal' }]);
  });

  it('spaces later sentences by the minimum interval', () => {
    const { announcer, calls, clock } = makeAnnouncer(600);
    announcer.push('First sentence is here. Second sentence is here. Third sentence is here. ');
    expect(calls.map((call) => call.text)).toEqual(['First sentence is here.']);

    clock.advance(599);
    expect(calls).toHaveLength(1);
    clock.advance(1);
    expect(calls.map((call) => call.text)).toEqual([
      'First sentence is here.',
      'Second sentence is here.',
    ]);
    clock.advance(600);
    expect(calls).toHaveLength(3);
  });

  it('announces completion after the last tail, exactly once', () => {
    const { announcer, calls } = makeAnnouncer();
    announcer.push('Only one sentence so far. and a tail');
    announcer.done();
    announcer.done();
    expect(calls.map((call) => call.text)).toEqual([
      'Only one sentence so far.',
      'and a tail Answer complete. 8 words.',
    ]);
    expect(announcer.state.phase).toBe('done');
  });

  it('announces an abort assertively and drops pending speech', () => {
    const { announcer, calls } = makeAnnouncer();
    announcer.push('First sentence is here. Second sentence is here. ');
    announcer.abort('user pressed stop');
    expect(calls.at(-1)).toEqual({ text: 'Answer stopped: user pressed stop.', priority: 'high' });
    expect(announcer.state.pending).toBe(0);
    expect(announcer.state.phase).toBe('aborted');
  });

  it('announces an error assertively', () => {
    const { announcer, calls } = makeAnnouncer();
    announcer.error('429 from the model');
    expect(calls.at(-1)).toEqual({ text: 'Answer failed: 429 from the model.', priority: 'high' });
    expect(announcer.state.phase).toBe('error');
  });

  it('ignores deltas after the end so late tokens cannot resurrect the answer', () => {
    const { announcer, calls } = makeAnnouncer();
    announcer.push('Enough text to be a sentence. ');
    announcer.done();
    const before = calls.length;
    announcer.push('late token ');
    expect(calls).toHaveLength(before);
  });

  it('throttles and de-duplicates status messages', () => {
    const { announcer, calls, clock } = makeAnnouncer();
    announcer.status('Searching the docs…');
    announcer.status('Searching the docs…');
    expect(calls).toHaveLength(1);
    clock.advance(1500);
    announcer.status('Searching the docs…');
    expect(calls).toHaveLength(1);
    clock.advance(1600);
    announcer.status('Searching the docs…');
    expect(calls).toHaveLength(2);
  });

  it('splits an unpunctuated tail at a word boundary', () => {
    const clock = createClock();
    const sink = createMemorySink(() => clock.now());
    const announcer = createStreamingAnnouncer({
      sink,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      minIntervalMs: 0,
      maxChunkChars: 30,
    });
    announcer.push('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu ');
    expect(sink.messages[0]?.text).toBe('alpha beta gamma delta');
    expect(announcer.state.buffered).toBeGreaterThan(0);
    announcer.done();
    expect(sink.messages.map((message) => message.text).join(' | ')).toContain('epsilon zeta eta theta');
  });

  it('speaks at most maxAnnouncements content chunks, then stays quiet until the end', () => {
    const clock = createClock();
    const { sink, calls } = trackAnnouncements();
    const announcer = createStreamingAnnouncer({
      sink: sink as never,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      minIntervalMs: 100,
      maxAnnouncements: 1,
    });
    announcer.push('First sentence here. Second sentence here. Third sentence here. ');
    clock.advance(500);
    expect(calls.map((call) => call.text)).toEqual(['First sentence here.']);
    expect(announcer.state.dropped).toBeGreaterThanOrEqual(1);
    announcer.done();
    expect(calls.at(-1)?.text).toBe('Answer complete. 9 words.');
  });

  it('resets for the next answer without disposing the sink', () => {
    const { announcer, calls } = makeAnnouncer();
    announcer.push('A complete sentence appears. ');
    announcer.done();
    const before = calls.length;
    announcer.reset();
    expect(announcer.state.phase).toBe('idle');
    expect(announcer.state.announced).toBe(0);
    announcer.push('A brand new answer starts. ');
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)?.text).toBe('A brand new answer starts.');
  });

  it('reports its mechanism from the sink', () => {
    const announcer = createStreamingAnnouncer({
      sink: createMemorySink(),
      now: () => 0,
      setTimer: ((callback: () => void) => {
        callback();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as never,
      clearTimer: (() => undefined) as never,
    });
    expect(announcer.state.mechanism).toBe('memory');
  });
});
