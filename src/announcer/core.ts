/**
 * `createStreamingAnnouncer()` — the correction half of livesay.
 *
 * Feed it token deltas, exactly as they arrive from the model. It does three
 * things and nothing else:
 *
 *   1. holds tokens until a sentence (or paragraph) is complete
 *   2. spaces announcements out, so the listener is not talked over
 *   3. announces completion, abort and error exactly once
 *
 * Endings are terminal: the first of `done()`/`abort()`/`error()` wins, later
 * calls are no-ops (an abort followed by `done()` must not announce a bogus
 * completion), and `status()` goes quiet too. A new answer may only start
 * after an explicit `reset()`.
 *
 * It uses `ariaNotify()` where available and a live region where not, through a
 * sink you can replace in tests.
 */

import { createDomSink, type AnnouncementSink } from './sink.js';
import { splitAtBoundary, takeCompleteSentences } from './sentences.js';
import { countWords } from '../text.js';

export type AnnouncerPhase = 'idle' | 'streaming' | 'done' | 'aborted' | 'error';

/** Phases an answer never leaves except through `reset()`. */
const TERMINAL: ReadonlySet<AnnouncerPhase> = new Set(['done', 'aborted', 'error']);

export interface AnnouncerState {
  phase: AnnouncerPhase;
  /** Chunks waiting for their turn to be spoken. */
  pending: number;
  /** Chunks spoken so far, including status, completion and error messages. */
  announced: number;
  /** Words of streamed content spoken so far. */
  contentWords: number;
  /** Characters buffered but not yet a complete sentence. */
  buffered: number;
  /** Content chunks skipped because of `maxAnnouncements`. */
  dropped: number;
  mechanism: AnnouncementSink['kind'];
}

export interface StreamingAnnouncerOptions {
  sink?: AnnouncementSink;
  /** Minimum gap between two polite announcements. */
  minIntervalMs?: number;
  /** Minimum gap between two `status()` messages. */
  statusIntervalMs?: number;
  /** Speak an unpunctuated tail once it grows past this many characters. */
  maxChunkChars?: number;
  /**
   * How many content chunks to speak before going quiet for the rest of the
   * answer. Speech is far slower than token output, so a listener who hears
   * every sentence falls minutes behind; announce the opening, then let them
   * read. Default: no limit.
   */
  maxAnnouncements?: number;
  completionText?: (context: { words: number }) => string;
  abortText?: (reason?: string) => string;
  errorText?: (message: string) => string;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface StreamingAnnouncer {
  push(delta: string): void;
  done(): void;
  abort(reason?: string): void;
  error(message: string): void;
  status(text: string): void;
  reset(): void;
  dispose(): void;
  readonly state: AnnouncerState;
  readonly sink: AnnouncementSink;
}

const defaultCompletion = ({ words }: { words: number }): string =>
  words > 0 ? `Answer complete. ${words} words.` : 'Answer complete.';
const defaultAbort = (reason?: string): string =>
  reason ? `Answer stopped: ${reason}.` : 'Answer stopped.';
const defaultError = (message: string): string => `Answer failed: ${message}.`;

const MAX_QUEUE = 80;

export function createStreamingAnnouncer(options: StreamingAnnouncerOptions = {}): StreamingAnnouncer {
  const sink = options.sink ?? createDomSink();
  const minIntervalMs = options.minIntervalMs ?? 700;
  const statusIntervalMs = options.statusIntervalMs ?? 1500;
  const maxChunkChars = options.maxChunkChars ?? 180;
  const maxAnnouncements = options.maxAnnouncements ?? Number.POSITIVE_INFINITY;
  const completionText = options.completionText ?? defaultCompletion;
  const abortText = options.abortText ?? defaultAbort;
  const errorText = options.errorText ?? defaultError;
  const now = options.now ?? ((): number => Date.now());
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

  let buffer = '';
  let streamed = '';
  let pending: string[] = [];
  let phase: AnnouncerPhase = 'idle';
  let lastSpokenAt = Number.NEGATIVE_INFINITY;
  let lastStatus = '';
  let lastStatusAt = Number.NEGATIVE_INFINITY;
  let announced = 0;
  let contentWords = 0;
  let contentChunks = 0;
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const speak = (text: string, priority: 'normal' | 'high', counted = true): void => {
    const trimmed = text.trim();
    if (!trimmed || disposed) return;
    sink.announce(trimmed, { priority });
    announced += 1;
    lastSpokenAt = now();
    if (counted) contentWords += countWords(trimmed);
  };

  const schedulePump = (delay: number): void => {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      pump();
    }, Math.max(0, delay));
  };

  const pump = (): void => {
    if (disposed) return;
    const next = pending[0];
    if (!next) return;
    const elapsed = now() - lastSpokenAt;
    if (elapsed < minIntervalMs) {
      schedulePump(minIntervalMs - elapsed);
      return;
    }
    pending.shift();
    contentChunks += 1;
    speak(next, 'normal');
    if (pending.length > 0) schedulePump(minIntervalMs);
  };

  const enqueue = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (contentChunks + pending.length >= maxAnnouncements) {
      dropped += 1;
      return;
    }
    pending.push(trimmed);
    if (pending.length > MAX_QUEUE) {
      // merge the overflow so a long answer cannot leave minutes of queued speech
      const merged = pending.splice(MAX_QUEUE - 1).join(' ');
      pending.push(merged);
    }
  };

  const announcer: StreamingAnnouncer = {
    get sink() {
      return sink;
    },

    get state(): AnnouncerState {
      return {
        phase,
        pending: pending.length,
        announced,
        contentWords,
        buffered: buffer.length,
        dropped,
        mechanism: sink.kind,
      };
    },

    push(delta: string): void {
      if (disposed || !delta) return;
      if (TERMINAL.has(phase)) return;
      phase = 'streaming';
      buffer += delta;
      streamed += delta;

      const { chunks, rest } = takeCompleteSentences(buffer);
      buffer = rest;
      for (const chunk of chunks) enqueue(chunk);

      if (buffer.length > maxChunkChars) {
        const { head, tail } = splitAtBoundary(buffer, maxChunkChars);
        if (head) {
          enqueue(head);
          buffer = tail;
        }
      }

      pump();
    },

    done(): void {
      if (disposed || TERMINAL.has(phase)) return;
      phase = 'done';
      cancelTimer();

      const tail = buffer.trim();
      buffer = '';
      if (tail) pending.push(tail);

      const rest = pending.join(' ').trim();
      pending = [];
      if (rest) contentWords += countWords(rest);

      // One call, not two: two rapid announcements can be coalesced by an AT or
      // dropped, and the completion is the one message that must arrive.
      const completion = completionText({ words: countWords(streamed) || contentWords });
      speak(rest ? `${rest} ${completion}` : completion, 'normal', false);
    },

    abort(reason?: string): void {
      if (disposed || TERMINAL.has(phase)) return;
      phase = 'aborted';
      cancelTimer();
      buffer = '';
      streamed = '';
      pending = [];
      speak(abortText(reason), 'high', false);
    },

    error(message: string): void {
      if (disposed || TERMINAL.has(phase)) return;
      phase = 'error';
      cancelTimer();
      buffer = '';
      streamed = '';
      pending = [];
      speak(errorText(message), 'high', false);
    },

    status(text: string): void {
      if (disposed || TERMINAL.has(phase)) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const at = now();
      if (trimmed === lastStatus && at - lastStatusAt < statusIntervalMs * 2) return;
      if (at - lastStatusAt < statusIntervalMs) return;
      lastStatus = trimmed;
      lastStatusAt = at;
      speak(trimmed, 'normal', false);
    },

    reset(): void {
      cancelTimer();
      buffer = '';
      streamed = '';
      pending = [];
      phase = 'idle';
      lastSpokenAt = Number.NEGATIVE_INFINITY;
      lastStatus = '';
      lastStatusAt = Number.NEGATIVE_INFINITY;
      announced = 0;
      contentWords = 0;
      contentChunks = 0;
      dropped = 0;
    },

    dispose(): void {
      announcer.reset();
      disposed = true;
      sink.dispose?.();
    },
  };

  return announcer;
}
