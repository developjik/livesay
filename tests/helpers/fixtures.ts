import type {
  AnswerRecord,
  ProbeEvent,
  ProbeSnapshot,
  RegionInfo,
  Utterance,
} from '../../src/types.js';

export const region = (overrides: Partial<RegionInfo> = {}): RegionInfo => ({
  id: 'r1',
  label: 'div#answer',
  role: null,
  politeness: 'polite',
  atomic: false,
  relevant: 'additions text',
  busy: false,
  ...overrides,
});

let sequence = 0;

interface RegionUpdateInput {
  t: number;
  text: string;
  previousText?: string;
  addedText?: string;
  region?: RegionInfo;
  attributesChanged?: boolean;
}

export function regionUpdate(input: RegionUpdateInput): ProbeEvent {
  const info = input.region ?? region();
  return {
    type: 'region-updated',
    t: input.t,
    seq: ++sequence,
    region: info,
    text: input.text,
    previousText: input.previousText ?? '',
    addedText: input.addedText ?? input.text,
    removedText: '',
    attributesChanged: input.attributesChanged ?? false,
  };
}

export function notify(t: number, text: string, priority: 'normal' | 'high' = 'normal'): ProbeEvent {
  return { type: 'notify', t, seq: ++sequence, text, priority, impl: 'native' };
}

export function mark(t: number, phase: 'start' | 'done' | 'abort' | 'error', answerId = 'a1'): ProbeEvent {
  return { type: 'mark', t, seq: ++sequence, phase, answerId };
}

export function snapshot(input: {
  events: ProbeEvent[];
  answers?: AnswerRecord[];
  regions?: RegionInfo[];
}): ProbeSnapshot {
  return {
    version: '0.1.0',
    url: 'https://example.test/chat',
    userAgent: 'test',
    startedAt: 0,
    capturedAt: 10_000,
    events: input.events,
    answers: input.answers ?? [],
    ariaNotify: { native: true, pageProvided: false },
    regions: input.regions ?? [region()],
  };
}

export function utterance(
  t: number,
  text: string,
  overrides: Partial<Utterance> = {},
): Utterance {
  return {
    index: 0,
    t,
    text,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    priority: 'normal',
    source: 'live-region',
    regionId: 'r1',
    ...overrides,
  };
}

/** A token-burst page: N updates 30ms apart starting at `from`. */
export function tokenBurst(from: number, count: number, step = 30, info = region()): ProbeEvent[] {
  const events: ProbeEvent[] = [];
  let text = '';
  for (let index = 0; index < count; index += 1) {
    text += `token${index} `;
    events.push(
      regionUpdate({
        t: from + index * step,
        text: text.trim(),
        previousText: index === 0 ? '' : text.trim().split(' ').slice(0, index).join(' '),
        addedText: `token${index} `,
        region: info,
      }),
    );
  }
  return events;
}
