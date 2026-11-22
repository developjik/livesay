/**
 * Wire format shared by the injected probe, the simulator, the rules and the CLI.
 *
 * Everything the probe records is *evidence*: what the page did, with a
 * timestamp. Interpretation ("what a screen reader would have said") lives in
 * the simulator, so that different AT assumptions can be compared over the same
 * recording.
 */

export type Politeness = 'polite' | 'assertive' | 'off';

/** ARIA notify priority. `high` interrupts, `normal` waits for a turn. */
export type Priority = 'normal' | 'high';

/** Lifecycle marker an app sends through the probe. */
export type AnswerPhase = 'start' | 'done' | 'abort' | 'error';

export type AnnouncementSource = 'aria-notify' | 'live-region';

export interface RegionInfo {
  /** Stable per-page id, e.g. `r3`. */
  id: string;
  /** Short human label, e.g. `div#answer.answer`. */
  label: string;
  role: string | null;
  politeness: Politeness;
  atomic: boolean;
  /** `aria-relevant` in effect, default `additions text`. */
  relevant: string;
  busy: boolean;
}

export interface ProbeEventBase {
  /** Milliseconds since the probe installed. */
  t: number;
  /** Monotonic counter; order is authoritative even when clocks tie. */
  seq: number;
}

/** A call to `ariaNotify()`, whether the browser's or a page-provided polyfill's. */
export type NotifyEvent = ProbeEventBase & {
  type: 'notify';
  text: string;
  priority: Priority;
  /** Which implementation received the call. */
  impl: 'native' | 'page' | 'none';
};

export type RegionAddedEvent = ProbeEventBase & {
  type: 'region-added';
  region: RegionInfo;
  text: string;
};

export type RegionUpdatedEvent = ProbeEventBase & {
  type: 'region-updated';
  region: RegionInfo;
  text: string;
  previousText: string;
  /** Text the mutation added, when it is an append. Empty for a rewrite. */
  addedText: string;
  removedText: string;
  /** True when only ARIA attributes changed and the text did not. */
  attributesChanged: boolean;
};

export type RegionRemovedEvent = ProbeEventBase & {
  type: 'region-removed';
  region: RegionInfo;
};

export type MarkEvent = ProbeEventBase & {
  type: 'mark';
  phase: AnswerPhase;
  answerId: string;
  detail?: string;
};

export type FocusEvent = ProbeEventBase & {
  type: 'focus-changed';
  target: string;
};

export type ProbeEvent =
  | NotifyEvent
  | RegionAddedEvent
  | RegionUpdatedEvent
  | RegionRemovedEvent
  | MarkEvent
  | FocusEvent;

export interface AnswerRecord {
  id: string;
  startedAt: number;
  endedAt: number | null;
  outcome: 'running' | 'done' | 'abort' | 'error';
  detail?: string;
}

export interface ProbeSnapshot {
  version: string;
  url: string;
  userAgent: string;
  /** 0 by definition; kept so a snapshot is self-describing. */
  startedAt: number;
  capturedAt: number;
  events: ProbeEvent[];
  answers: AnswerRecord[];
  ariaNotify: {
    /** A browser implementation existed when the probe installed. */
    native: boolean;
    /** A page script (usually a polyfill) installed one after the probe. */
    pageProvided: boolean;
  };
  regions: RegionInfo[];
}

export interface Utterance {
  index: number;
  /** Milliseconds since probe start, when speech would begin. */
  t: number;
  text: string;
  words: number;
  priority: Priority;
  source: AnnouncementSource;
  regionId?: string;
  /** Cut off by a later assertive announcement. */
  interrupted?: boolean;
  /** Never spoken because a newer update replaced it. */
  replaced?: 'coalesced' | 'atomic' | 'flushed';
  /** Notify calls folded into this utterance (last one wins). */
  folded?: number;
}
