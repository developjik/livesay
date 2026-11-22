/**
 * Turn a raw probe recording into the utterance timeline a given screen reader
 * would produce.
 *
 * No AT is the reference implementation, so the tool ships three profiles and
 * says "simulated" everywhere it reports. The profiles differ where real ATs
 * actually differ: whether polite updates queue or coalesce, and whether an
 * atomic region is re-read from the start.
 */

import { countWords } from './text.js';
import type {
  AnnouncementSource,
  ProbeSnapshot,
  Priority,
  RegionInfo,
  Utterance,
} from './types.js';

export type ProfileName = 'nvda-like' | 'voiceover-like' | 'spec-strict';

export interface Profile {
  name: ProfileName;
  tagline: string;
  /** How long one word occupies the speech channel. */
  msPerWord: number;
  minUtteranceMs: number;
  /** Polite updates while speaking: keep only the newest instead of queueing. */
  coalescePolite: boolean;
  /** …but only for updates this close together; a burst coalesces, spaced ones queue. */
  coalesceWindowMs: number;
  /** An atomic region rewrite cuts the current utterance and starts over. */
  atomicReplacesPending: boolean;
  /** An assertive announcement drops anything polite still waiting. */
  flushPoliteOnAssertive: boolean;
  /** Window in which rapid normal-priority `ariaNotify()` calls fold together. */
  notifyCoalesceMs: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  'nvda-like': {
    name: 'nvda-like',
    tagline: 'Polite speech coalesces; the newest pending update wins.',
    msPerWord: 240,
    minUtteranceMs: 350,
    coalescePolite: true,
    coalesceWindowMs: 250,
    atomicReplacesPending: false,
    flushPoliteOnAssertive: true,
    notifyCoalesceMs: 250,
  },
  'voiceover-like': {
    name: 'voiceover-like',
    tagline: 'Polite speech queues everything; verbose but never loses an update.',
    msPerWord: 300,
    minUtteranceMs: 400,
    coalescePolite: false,
    coalesceWindowMs: 0,
    atomicReplacesPending: false,
    flushPoliteOnAssertive: true,
    notifyCoalesceMs: 200,
  },
  'spec-strict': {
    name: 'spec-strict',
    tagline: 'Reads the ARIA spec literally: atomic regions re-read, queues never fold.',
    msPerWord: 240,
    minUtteranceMs: 350,
    coalescePolite: false,
    coalesceWindowMs: 0,
    atomicReplacesPending: true,
    flushPoliteOnAssertive: true,
    notifyCoalesceMs: 0,
  },
};

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];

export interface Simulation {
  profile: Profile;
  utterances: Utterance[];
  /** Every mutation that could have been announced (politeness != off). */
  candidates: number;
  /** Candidates that were never spoken because a newer update replaced them. */
  replaced: number;
  /** Notify calls folded into another due to `notifyCoalesceMs`. */
  folded: number;
  /** Candidates dropped because the region was `aria-busy`. */
  deferred: number;
}

interface Pending {
  text: string;
  priority: Priority;
  source: AnnouncementSource;
  regionId?: string;
  region?: RegionInfo;
  at: number;
  words: number;
}

export function simulate(snapshot: ProbeSnapshot, profileName: ProfileName = 'nvda-like'): Simulation {
  const profile = PROFILES[profileName] ?? PROFILES['nvda-like'];
  const utterances: Utterance[] = [];
  const queue: Array<{ utt: Utterance; queuedAt: number }> = [];

  let speaking: { utt: Utterance; endAt: number } | null = null;
  let candidates = 0;
  let replaced = 0;
  let folded = 0;
  let deferred = 0;

  const duration = (words: number): number =>
    Math.max(profile.minUtteranceMs, Math.round(words * profile.msPerWord));

  const speak = (utt: Utterance, at: number): void => {
    utt.t = Math.max(0, Math.round(at));
    utt.index = utterances.length;
    utterances.push(utt);
    speaking = { utt, endAt: utt.t + duration(utt.words) };
  };

  const markReplaced = (utt: Utterance, reason: NonNullable<Utterance['replaced']>): void => {
    if (utt.t === Number.POSITIVE_INFINITY) {
      utt.replaced = reason;
      replaced += 1;
    }
  };

  const toUtterance = (pending: Pending): Utterance => ({
    index: -1,
    t: Number.POSITIVE_INFINITY,
    text: pending.text,
    words: pending.words,
    priority: pending.priority,
    source: pending.source,
    ...(pending.regionId ? { regionId: pending.regionId } : {}),
  });

  /** Advance the speech channel to `t`, speaking anything whose turn came. */
  const settle = (t: number): void => {
    while (queue.length > 0 && (!speaking || speaking.endAt <= t)) {
      const next = queue.shift();
      if (!next) break;
      speak(next.utt, speaking ? speaking.endAt : Math.max(t, next.queuedAt));
    }
    if (speaking && speaking.endAt <= t) speaking = null;
  };

  const interrupt = (pending: Pending): void => {
    if (speaking) {
      speaking.utt.interrupted = true;
      speaking = null;
    }
    if (profile.flushPoliteOnAssertive && queue.length > 0) {
      for (const entry of queue) {
        if (entry.utt.priority === 'normal') markReplaced(entry.utt, 'flushed');
      }
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i]?.utt.priority === 'normal') queue.splice(i, 1);
      }
    }
    speak(toUtterance(pending), pending.at);
  };

  const enqueue = (pending: Pending): void => {
    const utt = toUtterance(pending);

    if (pending.priority === 'high') {
      interrupt(pending);
      return;
    }

    if (speaking && speaking.utt.priority === 'normal') {
      const sameRegion = pending.regionId && speaking.utt.regionId === pending.regionId;
      const wholeRegionRewrite = pending.region?.atomic ?? false;
      if (profile.atomicReplacesPending && sameRegion && wholeRegionRewrite) {
        speaking.utt.replaced = 'atomic';
        speaking = null;
      }
    }

    if (pending.source === 'aria-notify' && profile.notifyCoalesceMs > 0) {
      const last = queue[queue.length - 1];
      if (last && last.utt.source === 'aria-notify' && pending.at - last.queuedAt <= profile.notifyCoalesceMs) {
        last.utt.text = pending.text;
        last.utt.words = pending.words;
        last.utt.folded = (last.utt.folded ?? 0) + 1;
        folded += 1;
        return;
      }
    }

    if (profile.coalescePolite) {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        const entry = queue[i];
        if (!entry) continue;
        if (entry.utt.priority !== 'normal') continue;
        if (pending.at - entry.queuedAt > profile.coalesceWindowMs) break;
        entry.utt.replaced = 'coalesced';
        queue.splice(i, 1);
        replaced += 1;
        break;
      }
    }

    if (!speaking) {
      speak(utt, pending.at);
      return;
    }
    queue.push({ utt, queuedAt: pending.at });
  };

  for (const event of snapshot.events) {
    settle(event.t);

    if (event.type === 'notify') {
      if (!event.text) continue;
      candidates += 1;
      enqueue({
        text: event.text,
        priority: event.priority,
        source: 'aria-notify',
        at: event.t,
        words: countWords(event.text),
      });
      continue;
    }

    if (event.type !== 'region-updated' && event.type !== 'region-added') continue;

    const region = event.region;
    if (event.type === 'region-updated' && event.attributesChanged && event.text === event.previousText) {
      continue;
    }
    if (region.politeness === 'off') continue;

    if (region.busy) {
      deferred += 1;
      continue;
    }

    const text = region.atomic ? event.text : event.type === 'region-added' ? event.text : event.addedText;
    if (!text.trim()) continue;

    candidates += 1;
    enqueue({
      text,
      priority: region.politeness === 'assertive' ? 'high' : 'normal',
      source: 'live-region',
      regionId: region.id,
      region,
      at: event.t,
      words: countWords(text),
    });
  }

  settle(Number.POSITIVE_INFINITY);

  return { profile, utterances, candidates, replaced, folded, deferred };
}
