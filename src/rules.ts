/**
 * Audit rules. Each rule is a pure function over the recording (and its
 * simulated utterance timeline), so every finding can name the evidence that
 * produced it — a timestamp, a region, the text that went out.
 *
 * The rules are contracts, not a WCAG verdict: "announce the end", "don't
 * re-announce every token", "one assertive moment per answer".
 */

import { countWords, endsMidSentence, isStrictPrefix, normalizeForCompare, truncate } from './text.js';
import type { Simulation } from './simulate.js';
import type { ProbeSnapshot, RegionInfo, Utterance } from './types.js';

export type RuleId =
  | 'token-storm'
  | 'silent-completion'
  | 'silent-abort'
  | 'assertive-abuse'
  | 'duplicate-announcement'
  | 'partial-announcement';

export type Severity = 'error' | 'warn';

export interface Finding {
  rule: RuleId;
  severity: Severity;
  title: string;
  message: string;
  suggestion: string;
  evidence: Record<string, unknown>;
}

export interface ResolvedRuleOptions {
  stormWindowMs: number;
  stormMinUpdates: number;
  duplicateWindowMs: number;
  assertiveLimit: number;
  completionGraceMs: number;
  completionPattern: RegExp;
  abortPattern: RegExp;
  partialMinChars: number;
  maxFindings: number;
}

export const DEFAULT_RULE_OPTIONS: ResolvedRuleOptions = {
  stormWindowMs: 1000,
  stormMinUpdates: 5,
  duplicateWindowMs: 8000,
  assertiveLimit: 1,
  completionGraceMs: 1500,
  completionPattern: /complete|finished|ready|done|all set|완료|끝났|마쳤|다 읽|답변.*끝/i,
  abortPattern: /stop|cancel|interrupt|fail|error|취소|중단|오류|실패/i,
  partialMinChars: 3,
  maxFindings: 40,
};

export interface PeakWindow {
  peak: number;
  start: number;
}

/** Highest number of timestamps inside any `window` ms slice. */
export function peakInWindow(times: number[], window: number): PeakWindow {
  const sorted = [...times].sort((a, b) => a - b);
  let peak = 0;
  let start = sorted[0] ?? 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    const current = sorted[right];
    if (current === undefined) continue;
    while (left < right && current - (sorted[left] ?? current) > window) left += 1;
    const count = right - left + 1;
    if (count > peak) {
      peak = count;
      start = sorted[left] ?? current;
    }
  }
  return { peak, start };
}

interface RegionBurst {
  region: RegionInfo;
  times: number[];
  texts: string[];
}

function regionBursts(snapshot: ProbeSnapshot): RegionBurst[] {
  const map = new Map<string, RegionBurst>();
  for (const event of snapshot.events) {
    if (event.type !== 'region-updated') continue;
    if (event.region.politeness === 'off') continue;
    if (event.attributesChanged && event.text === event.previousText) continue;
    if (!event.text.trim()) continue;
    const existing = map.get(event.region.id);
    if (existing) {
      existing.times.push(event.t);
      existing.texts.push(event.text);
    } else {
      map.set(event.region.id, { region: event.region, times: [event.t], texts: [event.text] });
    }
  }
  return [...map.values()];
}

/**
 * Token-by-token chatter: a live region rewritten many times inside one second.
 * This is the failure mode that makes a streamed answer unlistenable — every
 * token becomes an announcement, or a fragment of one.
 */
export function findTokenStorm(snapshot: ProbeSnapshot, options: ResolvedRuleOptions): Finding[] {
  const findings: Finding[] = [];

  for (const burst of regionBursts(snapshot)) {
    const { peak, start } = peakInWindow(burst.times, options.stormWindowMs);
    if (peak < options.stormMinUpdates) continue;
    const sampleIndex = burst.times.indexOf(start);
    findings.push({
      rule: 'token-storm',
      severity: 'error',
      title: 'Token-by-token chatter',
      message: `${burst.region.label} was rewritten ${peak} times within ${options.stormWindowMs}ms (${burst.times.length} updates total). Each rewrite is a speech event for a live region.`,
      suggestion:
        'Keep the streamed text out of a live region. Announce at sentence boundaries with a throttled announcer, or set aria-live="off" on the answer body and speak from a separate polite region.',
      evidence: {
        region: burst.region.label,
        regionId: burst.region.id,
        politeness: burst.region.politeness,
        atomic: burst.region.atomic,
        peakUpdates: peak,
        windowMs: options.stormWindowMs,
        windowStartMs: start,
        totalUpdates: burst.times.length,
        sample: burst.texts.slice(Math.max(0, sampleIndex), sampleIndex + 4).map((text) => truncate(text, 80)),
      },
    });
  }

  const notifyTimes = snapshot.events.filter((event) => event.type === 'notify').map((event) => event.t);
  const notifyPeak = peakInWindow(notifyTimes, options.stormWindowMs);
  if (notifyPeak.peak >= options.stormMinUpdates) {
    findings.push({
      rule: 'token-storm',
      severity: 'error',
      title: 'ariaNotify() called per token',
      message: `ariaNotify() was called ${notifyPeak.peak} times within ${options.stormWindowMs}ms. Calls are not guaranteed to be read in order, and usually only the last one is spoken.`,
      suggestion:
        'Batch before calling: one ariaNotify() per sentence or clause, never per token. `createStreamingAnnouncer` does this for you.',
      evidence: {
        peakCalls: notifyPeak.peak,
        windowMs: options.stormWindowMs,
        windowStartMs: notifyPeak.start,
        totalCalls: notifyTimes.length,
      },
    });
  }

  return findings;
}

interface AnnouncementEvent {
  t: number;
  seq: number;
  text: string;
}

/**
 * Every DOM-side announcement the page made, in order.
 *
 * Silent-completion and silent-abort are judged on *these*, not on the simulated
 * utterance timeline: speech lags the DOM, so a backlogged token can be "spoken"
 * after the stream ends without the page ever having signalled anything.
 */
function announcementEvents(snapshot: ProbeSnapshot): AnnouncementEvent[] {
  const events: AnnouncementEvent[] = [];
  for (const event of snapshot.events) {
    if (event.type === 'notify') {
      if (event.text.trim()) events.push({ t: event.t, seq: event.seq, text: event.text });
      continue;
    }
    if (event.type === 'region-added' || event.type === 'region-updated') {
      if (event.region.politeness === 'off') continue;
      if (event.type === 'region-updated' && event.attributesChanged && event.text === event.previousText) continue;
      if (!event.text.trim()) continue;
      events.push({ t: event.t, seq: event.seq, text: event.text });
    }
  }
  return events;
}

/**
 * Everything the page streamed up to `untilSeq`, normalised for comparison, so a
 * fragment of the answer is not mistaken for a completion message.
 */
function contentCorpus(snapshot: ProbeSnapshot, untilSeq: number): string {
  return normalizeForCompare(
    announcementEvents(snapshot)
      .filter((event) => event.seq < untilSeq)
      .map((event) => event.text)
      .join(' '),
  );
}

interface SignalCounts {
  after: number;
  before: number;
  lastBefore: AnnouncementEvent | null;
}

/** Order is compared by `seq`: a mark and the mutation it flushed can share a millisecond. */
function countSignals(
  snapshot: ProbeSnapshot,
  markSeq: number,
  markAt: number,
  pattern: RegExp,
  windowEndSeq = Number.POSITIVE_INFINITY,
): SignalCounts {
  const list = announcementEvents(snapshot);
  const before = list.filter((event) => event.seq < markSeq);
  const corpusBeforeMark = normalizeForCompare(before.map((event) => event.text).join(' '));

  let after = 0;
  for (const event of list) {
    if (event.seq <= markSeq || event.seq > windowEndSeq) continue;
    // A message after the end counts as a signal when it says so, or when it is
    // something the answer itself never said (the backlog case).
    if (pattern.test(event.text) || !corpusBeforeMark.includes(normalizeForCompare(event.text))) {
      after += 1;
    }
  }

  // An app may announce and then mark. Accept a single short final message that
  // names the end, but never a streamed answer that merely contains the word.
  const lastBefore = before.at(-1) ?? null;
  let hinted = 0;
  if (
    lastBefore &&
    lastBefore.t >= markAt - 2000 &&
    pattern.test(lastBefore.text) &&
    countWords(lastBefore.text) <= 25
  ) {
    const ownCorpus = normalizeForCompare(
      before
        .slice(0, -1)
        .map((event) => event.text)
        .join(' '),
    );
    if (!ownCorpus.includes(normalizeForCompare(lastBefore.text))) hinted = 1;
  }

  return { after, before: hinted, lastBefore };
}

function markSeqFor(snapshot: ProbeSnapshot, answerId: string, phase: string): number {
  const marks = snapshot.events.filter(
    (event) => event.type === 'mark' && event.answerId === answerId && event.phase === phase,
  );
  return marks.at(-1)?.seq ?? Number.POSITIVE_INFINITY;
}

/**
 * Silent completion: the answer finished and nothing was said. This is the
 * single most reported AI-chat accessibility bug — "they never say when the
 * answer is done" — and the one no static checker can see.
 */
export function findSilentCompletion(snapshot: ProbeSnapshot, options: ResolvedRuleOptions): Finding[] {
  const findings: Finding[] = [];

  for (const answer of snapshot.answers) {
    if (answer.outcome !== 'done' || answer.endedAt === null) continue;
    const next = snapshot.answers.find((other) => other.startedAt > (answer.endedAt ?? 0));
    const { after, before, lastBefore } = countSignals(
      snapshot,
      markSeqFor(snapshot, answer.id, answer.outcome),
      answer.endedAt,
      options.completionPattern,
      next ? markSeqFor(snapshot, next.id, 'start') : Number.POSITIVE_INFINITY,
    );
    if (after > 0 || before > 0) continue;

    findings.push({
      rule: 'silent-completion',
      severity: 'error',
      title: 'Answer ended without a completion announcement',
      message: lastBefore
        ? `The stream finished at ${answer.endedAt}ms, but the last announcement came at ${lastBefore.t}ms — nothing told the listener the answer was complete.`
        : 'The answer finished and no announcement was made at all.',
      suggestion:
        'Call announcer.done() when the stream ends. One short sentence ("Answer complete, 84 words") is enough; it is also the user\'s cue to start reading.',
      evidence: {
        answerId: answer.id,
        endedAtMs: answer.endedAt,
        graceMs: options.completionGraceMs,
        announcementsAfterEnd: after,
        lastUtterance: lastBefore ? { t: lastBefore.t, text: truncate(lastBefore.text, 120) } : null,
      },
    });
  }

  return findings;
}

/** Silent abort/error: the stream stopped or failed and the listener was not told. */
export function findSilentAbort(snapshot: ProbeSnapshot, options: ResolvedRuleOptions): Finding[] {
  const findings: Finding[] = [];

  for (const answer of snapshot.answers) {
    if ((answer.outcome !== 'abort' && answer.outcome !== 'error') || answer.endedAt === null) continue;
    const next = snapshot.answers.find((other) => other.startedAt > (answer.endedAt ?? 0));
    const { after, before } = countSignals(
      snapshot,
      markSeqFor(snapshot, answer.id, answer.outcome),
      answer.endedAt,
      options.abortPattern,
      next ? markSeqFor(snapshot, next.id, 'start') : Number.POSITIVE_INFINITY,
    );
    if (after > 0 || before > 0) continue;

    findings.push({
      rule: 'silent-abort',
      severity: 'error',
      title: `Answer ${answer.outcome === 'abort' ? 'stopped' : 'failed'} silently`,
      message: `The stream ended with "${answer.outcome}" at ${answer.endedAt}ms and no announcement followed. For a listener, the page simply went quiet.`,
      suggestion:
        'Announce the interruption with assertive priority once ("Answer stopped"), then leave the partial text readable in the transcript.',
      evidence: {
        answerId: answer.id,
        outcome: answer.outcome,
        endedAtMs: answer.endedAt,
        detail: answer.detail ?? null,
      },
    });
  }

  return findings;
}

/**
 * One boolean for a UI badge: did every finished answer signal its end?
 * `null` when the recording has no completion mark to judge.
 */
export function hasCompletionSignal(snapshot: ProbeSnapshot): boolean | null {
  const answered = snapshot.answers.filter((answer) => answer.outcome === 'done' && answer.endedAt !== null);
  if (answered.length === 0) return null;
  return answered.every(
    (answer) => findSilentCompletion({ ...snapshot, answers: [answer] }, DEFAULT_RULE_OPTIONS).length === 0,
  );
}

/** Assertive announcements are interrupts: more than one per answer fights the listener. */
export function findAssertiveAbuse(simulation: Simulation, options: ResolvedRuleOptions): Finding[] {
  const findings: Finding[] = [];
  const assertive = simulation.utterances.filter((utterance) => utterance.priority === 'high');
  const interrupted = simulation.utterances.filter((utterance) => utterance.interrupted);

  if (assertive.length > options.assertiveLimit) {
    findings.push({
      rule: 'assertive-abuse',
      severity: 'error',
      title: 'Assertive announcements used for routine updates',
      message: `${assertive.length} assertive announcements were spoken (limit ${options.assertiveLimit}). Each one cuts off whatever the screen reader was saying${
        interrupted.length > 0 ? ` — ${interrupted.length} polite utterance(s) were interrupted` : ''
      }.`,
      suggestion:
        'Reserve assertive for errors and interruptions. Status and progress belong in a polite region.',
      evidence: {
        assertiveCount: assertive.length,
        interrupted: interrupted.length,
        limit: options.assertiveLimit,
        sample: assertive.slice(0, 3).map((utterance) => ({ t: utterance.t, text: truncate(utterance.text, 80) })),
      },
    });
  } else if (interrupted.length > 0) {
    findings.push({
      rule: 'assertive-abuse',
      severity: 'warn',
      title: 'Assertive announcement cut off polite speech',
      message: `An assertive announcement interrupted ${interrupted.length} polite utterance(s) mid-sentence.`,
      suggestion:
        'If the interruption was a genuine error, keep it. Otherwise let the current sentence finish.',
      evidence: {
        interrupted: interrupted.length,
        interruptedText: interrupted.slice(0, 3).map((utterance) => truncate(utterance.text, 80)),
      },
    });
  }

  return findings;
}

const duplicatesKey = (utterance: Utterance): string => normalizeForCompare(utterance.text);

/** The same sentence spoken twice in a row (or a rewrite that re-reads what was already read). */
export function findDuplicates(simulation: Simulation, options: ResolvedRuleOptions): Finding[] {
  const findings: Finding[] = [];
  const announced = new Map<string, Utterance[]>();

  for (const utterance of simulation.utterances) {
    const key = duplicatesKey(utterance);
    if (!key || utterance.words < 2) continue;
    const bucket = announced.get(key);
    if (bucket) bucket.push(utterance);
    else announced.set(key, [utterance]);
  }

  const repeats: Array<{ text: string; times: number[] }> = [];
  for (const [, bucket] of announced) {
    for (let i = 1; i < bucket.length; i += 1) {
      const current = bucket[i];
      const previous = bucket[i - 1];
      if (!current || !previous) continue;
      if (current.t - previous.t <= options.duplicateWindowMs) {
        repeats.push({ text: current.text, times: [previous.t, current.t] });
        break;
      }
    }
  }

  if (repeats.length > 0) {
    findings.push({
      rule: 'duplicate-announcement',
      severity: 'warn',
      title: 'Duplicate announcement',
      message: `${repeats.length} passage(s) were announced more than once within ${options.duplicateWindowMs}ms.`,
      suggestion:
        'De-duplicate by text before announcing, and prefer appending to a non-atomic region over rewriting the whole answer.',
      evidence: {
        repeats: repeats.slice(0, 5).map((repeat) => ({ text: truncate(repeat.text, 80), timesMs: repeat.times })),
      },
    });
  }

  return findings;
}

/**
 * Partial announcements: one utterance is a truncated prefix of the next, so the
 * listener hears the beginning of a sentence, then the whole sentence again.
 */
export function findPartials(simulation: Simulation, options: ResolvedRuleOptions): Finding[] {
  const partials: Array<{ first: string; then: string; timesMs: [number, number] }> = [];

  for (let i = 1; i < simulation.utterances.length; i += 1) {
    const previous = simulation.utterances[i - 1];
    const current = simulation.utterances[i];
    if (!previous || !current) continue;
    if (previous.source !== current.source) continue;
    if (previous.regionId !== current.regionId) continue;
    if (!endsMidSentence(previous.text)) continue;
    if (previous.text.trim().length < options.partialMinChars) continue;
    if (!isStrictPrefix(previous.text.trim(), current.text.trim())) continue;
    partials.push({
      first: truncate(previous.text, 80),
      then: truncate(current.text, 80),
      timesMs: [previous.t, current.t],
    });
  }

  if (partials.length === 0) return [];
  return [
    {
      rule: 'partial-announcement',
      severity: 'warn',
      title: 'Partial, re-spoken announcements',
      message: `${partials.length} utterance(s) were cut off mid-sentence and then re-read from the start.`,
      suggestion:
        'Speak only complete sentences. Buffer the stream until a sentence boundary, then announce once.',
      evidence: { partials: partials.slice(0, 6) },
    },
  ];
}

export interface Metrics {
  updates: number;
  silentUpdates: number;
  peakUpdatesPerSecond: number;
  candidates: number;
  utterances: number;
  words: number;
  /** null when the recording has no measurable answer duration. */
  wordsPerMinute: number | null;
  durationMs: number;
  partials: number;
  duplicates: number;
  assertive: number;
  interruptions: number;
  replaced: number;
  folded: number;
  deferred: number;
  completionAnnounced: boolean | null;
  answers: number;
}

export function collectMetrics(
  snapshot: ProbeSnapshot,
  simulation: Simulation,
  options: ResolvedRuleOptions,
): Metrics {
  const updates = snapshot.events.filter((event) => event.type === 'region-updated').length;
  const silentUpdates = snapshot.events.filter(
    (event) => event.type === 'region-updated' && event.region.politeness === 'off',
  ).length;

  const burstPeaks = regionBursts(snapshot).map((burst) => peakInWindow(burst.times, options.stormWindowMs).peak);
  const notifyTimes = snapshot.events.filter((event) => event.type === 'notify').map((event) => event.t);
  burstPeaks.push(peakInWindow(notifyTimes, options.stormWindowMs).peak);

  const answered = snapshot.answers.filter((answer) => answer.endedAt !== null);
  const first = answered[0];
  const startedAt = first?.startedAt ?? 0;
  const endedAt = answered.reduce((latest, answer) => Math.max(latest, answer.endedAt ?? 0), 0);
  const durationMs = Math.max(0, endedAt - startedAt);

  const words = simulation.utterances.reduce((total, utterance) => total + utterance.words, 0);
  const duplicateFindings = findDuplicates(simulation, options);
  const partialFindings = findPartials(simulation, options);
  const partials = (partialFindings[0]?.evidence.partials as unknown[] | undefined)?.length ?? 0;
  const duplicates = (duplicateFindings[0]?.evidence.repeats as unknown[] | undefined)?.length ?? 0;

  let completionAnnounced: boolean | null = null;
  if (answered.length > 0) {
    completionAnnounced = answered.every((answer) => {
      if (answer.outcome !== 'done' || answer.endedAt === null) return true;
      return findSilentCompletion({ ...snapshot, answers: [answer] }, options).length === 0;
    });
  }

  return {
    updates,
    silentUpdates,
    peakUpdatesPerSecond: burstPeaks.reduce((max, value) => Math.max(max, value), 0),
    candidates: simulation.candidates,
    utterances: simulation.utterances.length,
    words,
    wordsPerMinute: durationMs >= 500 ? Math.round((words / durationMs) * 60_000) : null,
    durationMs,
    partials,
    duplicates,
    assertive: simulation.utterances.filter((utterance) => utterance.priority === 'high').length,
    interruptions: simulation.utterances.filter((utterance) => utterance.interrupted).length,
    replaced: simulation.replaced,
    folded: simulation.folded,
    deferred: simulation.deferred,
    completionAnnounced,
    answers: snapshot.answers.length,
  };
}

