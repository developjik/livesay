import { vi } from 'vitest';

/** Deterministic timers for the announcer, so pacing can be asserted exactly. */
export interface Clock {
  now(): number;
  setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
  advance(ms: number): void;
  pending(): number;
}

export function createClock(): Clock {
  let time = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    now: () => time,
    setTimer(callback, ms) {
      const id = ++sequence;
      timers.set(id, { at: time + ms, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(handle) {
      timers.delete(handle as unknown as number);
    },
    advance(ms) {
      const target = time + ms;
      for (;;) {
        let nextId = -1;
        let nextAt = Number.POSITIVE_INFINITY;
        for (const [id, timer] of timers) {
          if (timer.at <= target && timer.at < nextAt) {
            nextAt = timer.at;
            nextId = id;
          }
        }
        if (nextId === -1) break;
        const timer = timers.get(nextId);
        timers.delete(nextId);
        time = nextAt;
        timer?.callback();
      }
      time = target;
    },
    pending: () => timers.size,
  };
}

/** A vi.fn() sink whose calls are easy to read in assertions. */
export function trackAnnouncements(): {
  sink: { kind: 'memory'; announce: (text: string, options: { priority: 'normal' | 'high' }) => void };
  calls: Array<{ text: string; priority: string }>;
} {
  const calls: Array<{ text: string; priority: string }> = [];
  const announce = vi.fn((text: string, options: { priority: 'normal' | 'high' }) => {
    calls.push({ text, priority: options.priority });
  });
  return { sink: { kind: 'memory', announce }, calls };
}
