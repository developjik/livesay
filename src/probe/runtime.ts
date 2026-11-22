/**
 * The injected probe. This file runs inside the page, before any app code, and
 * records two kinds of evidence with timestamps:
 *
 *   1. every `ariaNotify()` call (native, or a polyfill the page installs later)
 *   2. every mutation of a live region — `aria-live`, `role=status|alert|log|marquee|timer`
 *
 * It does not interpret anything. "What a screen reader would have said" is the
 * simulator's job, so one recording can be replayed under several AT profiles.
 *
 * Safety: the probe never throws into the page, never changes layout, and the
 * only writes it makes are one expando (`window.__livesayProbe`) and a data
 * attribute the CLI can wait on.
 */

import type {
  AnswerPhase,
  Priority,
  ProbeEvent,
  ProbeSnapshot,
  RegionInfo,
} from '../types.js';

export const PROBE_VERSION = '0.1.0';

/** Hard cap so a runaway page cannot exhaust memory mid-audit. */
const DEFAULT_MAX_EVENTS = 60_000;

interface RegionState {
  el: Element;
  info: RegionInfo;
  previousText: string;
  signature: string;
}

export interface ProbeHandle {
  version: string;
  mark(phase: AnswerPhase, options?: { id?: string; detail?: string }): void;
  snapshot(): ProbeSnapshot;
  reset(): void;
  regions(): RegionInfo[];
  /** Milliseconds since install. */
  now(): number;
}

interface ProbeGlobal {
  __livesayProbe?: ProbeHandle;
}

const ROLE_DEFAULTS: Record<string, { politeness: 'polite' | 'assertive' | 'off'; atomic: boolean }> = {
  status: { politeness: 'polite', atomic: true },
  alert: { politeness: 'assertive', atomic: true },
  log: { politeness: 'polite', atomic: false },
  marquee: { politeness: 'off', atomic: false },
  timer: { politeness: 'off', atomic: false },
};

const IMPLICIT_ROLES: Record<string, string> = {
  output: 'status',
  progress: 'progressbar',
};

const REGION_SELECTOR = '[aria-live], [role], output';

const OBSERVED_ATTRIBUTES = [
  'aria-live',
  'aria-atomic',
  'aria-relevant',
  'aria-busy',
  'role',
];

const MAX_TEXT = 20_000;

/** Omit that distributes over a union, so each event shape keeps its own keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ProbeEventInput = DistributiveOmit<ProbeEvent, 't' | 'seq'> & { t?: number; seq?: number };

const trimText = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_TEXT ? `${normalized.slice(0, MAX_TEXT)}…` : normalized;
};

const textOf = (el: Element): string => trimText((el as HTMLElement).textContent ?? '');

const roleOf = (el: Element): string | null => {
  const explicit = el.getAttribute('role');
  if (explicit) {
    const first = explicit.trim().toLowerCase().split(/\s+/)[0];
    return first || null;
  }
  return IMPLICIT_ROLES[el.tagName.toLowerCase()] ?? null;
};

const labelOf = (el: Element): string => {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = el.getAttribute('class')?.trim().split(/\s+/)[0];
  return cls ? `${tag}.${cls}` : tag;
};

/** Resolve the region semantics ARIA gives this element, or null if it is not a live region. */
function describeRegion(el: Element): Omit<RegionInfo, 'id'> | null {
  const role = roleOf(el);
  const roleDefaults = role ? ROLE_DEFAULTS[role] : undefined;
  const liveAttr = el.getAttribute('aria-live')?.trim().toLowerCase();

  if (!el.hasAttribute('aria-live') && !roleDefaults) return null;

  let politeness: RegionInfo['politeness'];
  if (liveAttr === 'polite' || liveAttr === 'assertive' || liveAttr === 'off') {
    politeness = liveAttr;
  } else {
    politeness = roleDefaults?.politeness ?? 'off';
  }

  const atomicAttr = el.getAttribute('aria-atomic')?.trim().toLowerCase();
  const atomic =
    atomicAttr === 'true' ? true : atomicAttr === 'false' ? false : (roleDefaults?.atomic ?? false);

  return {
    label: labelOf(el),
    role,
    politeness,
    atomic,
    relevant: el.getAttribute('aria-relevant')?.trim().toLowerCase() || 'additions text',
    busy: el.getAttribute('aria-busy')?.trim().toLowerCase() === 'true',
  };
}

const signatureOf = (el: Element): string =>
  [
    roleOf(el) ?? '',
    el.getAttribute('aria-live') ?? '',
    el.getAttribute('aria-atomic') ?? '',
    el.getAttribute('aria-relevant') ?? '',
    el.getAttribute('aria-busy') ?? '',
  ].join('|');

export function installProbeRuntime(
  win: Window & typeof globalThis,
  options: { maxEvents?: number } = {},
): ProbeHandle {
  const globalRef = win as unknown as ProbeGlobal;
  if (globalRef.__livesayProbe) return globalRef.__livesayProbe;

  const doc = win.document;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const t0 = typeof win.performance?.now === 'function' ? win.performance.now() : Date.now();
  const now = (): number =>
    Math.round((typeof win.performance?.now === 'function' ? win.performance.now() : Date.now()) - t0);

  let seq = 0;
  let events: ProbeEvent[] = [];
  let answerSeq = 0;
  let regionSeq = 0;
  const answers: ProbeSnapshot['answers'] = [];
  const regions = new Map<Element, RegionState>();

  const record = (event: ProbeEventInput): void => {
    const full = { ...event, t: event.t ?? now(), seq: ++seq } as ProbeEvent;
    events.push(full);
    if (events.length > maxEvents) events = events.slice(events.length - maxEvents);
  };

  const regionInfo = (state: RegionState): RegionInfo => state.info;

  // ---------------------------------------------------------------- ariaNotify

  let implementation: ((message: string, opts?: { priority?: string }) => void) | null = null;
  let implAtInstall: 'native' | 'page' | 'none' = 'none';
  let implIsPage = false;

  const existingNotify = (win as unknown as { ariaNotify?: unknown }).ariaNotify;
  if (typeof existingNotify === 'function') {
    implementation = existingNotify as (message: string, opts?: { priority?: string }) => void;
    implAtInstall = 'native';
  }

  const wrappedNotify = function ariaNotify(
    this: unknown,
    message: unknown,
    opts?: { priority?: string },
  ): void {
    const text = trimText(String(message ?? ''));
    const priority: Priority = opts?.priority === 'high' ? 'high' : 'normal';
    record({
      type: 'notify',
      text,
      priority,
      impl: implementation === null ? 'none' : implIsPage ? 'page' : implAtInstall,
    });
    if (implementation && text) {
      try {
        implementation.call(win, String(message ?? ''), opts);
      } catch {
        /* the page's own implementation must not break the audit */
      }
    }
  };

  try {
    Object.defineProperty(win, 'ariaNotify', {
      configurable: true,
      enumerable: false,
      // Feature detection must stay honest: when the browser has no ariaNotify
      // and the page has not installed one, the property reads as undefined.
      // A probe that pretended otherwise would push apps onto a dead API.
      get: () => (implementation ? wrappedNotify : undefined),
      set: (value: unknown) => {
        if (typeof value === 'function') {
          implementation = value as (message: string, opts?: { priority?: string }) => void;
          implIsPage = implAtInstall !== 'native';
        } else {
          implementation = null;
        }
      },
    });
  } catch {
    try {
      (win as unknown as { ariaNotify?: unknown }).ariaNotify = wrappedNotify;
    } catch {
      /* older engines: recording still works through live regions */
    }
  }

  // --------------------------------------------------------------- live regions

  const register = (el: Element, announceAdd: boolean): RegionState | null => {
    const existing = regions.get(el);
    if (existing) return existing;
    const described = describeRegion(el);
    if (!described) return null;
    const state: RegionState = {
      el,
      info: { id: `r${++regionSeq}`, ...described },
      previousText: textOf(el),
      signature: signatureOf(el),
    };
    regions.set(el, state);
    if (announceAdd) {
      record({ type: 'region-added', region: regionInfo(state), text: state.previousText });
    }
    return state;
  };

  const unregister = (el: Element): void => {
    const state = regions.get(el);
    if (!state) return;
    regions.delete(el);
    record({ type: 'region-removed', region: regionInfo(state) });
  };

  const scanSubtree = (root: Element, touched: Set<RegionState>): void => {
    if (root.matches?.(REGION_SELECTOR)) {
      const state = register(root, true) ?? regions.get(root) ?? null;
      if (state) touched.add(state);
    }
    const matches = root.querySelectorAll?.(REGION_SELECTOR);
    if (!matches) return;
    for (const el of Array.from(matches)) {
      const state = register(el, true) ?? regions.get(el) ?? null;
      if (state) touched.add(state);
    }
  };

  const registerAncestors = (node: Node): void => {
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
    let depth = 0;
    const chain: Element[] = [];
    while (el && depth++ < 64) {
      if (el.matches?.(REGION_SELECTOR) && !regions.has(el)) chain.push(el);
      el = el.parentElement;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const candidate = chain[i];
      if (candidate) register(candidate, true);
    }
  };

  const nearestRegion = (node: Node): RegionState | null => {
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
    let depth = 0;
    while (el && depth++ < 64) {
      const state = regions.get(el);
      if (state) return state;
      el = el.parentElement;
    }
    return null;
  };

  const flushRegion = (state: RegionState): void => {
    const text = textOf(state.el);
    const signature = signatureOf(state.el);
    const attributesChanged = signature !== state.signature;
    if (text === state.previousText && !attributesChanged) return;

    const described = describeRegion(state.el);
    if (!described) {
      unregister(state.el);
      return;
    }

    const previousText = state.previousText;
    const addedText = text.startsWith(previousText)
      ? text.slice(previousText.length)
      : previousText && text.endsWith(previousText)
        ? ''
        : text;
    const removedText = previousText.startsWith(text) ? previousText.slice(text.length) : '';

    state.info = { ...state.info, ...described };
    state.previousText = text;
    state.signature = signature;

    record({
      type: 'region-updated',
      region: regionInfo(state),
      text,
      previousText,
      addedText,
      removedText,
      attributesChanged,
    });
  };

  const handleRecords = (records: MutationRecord[]): void => {
    const touched = new Set<RegionState>();
    for (const mutation of records) {
      const target = mutation.target;

      if (mutation.type === 'attributes') {
        const el = target as Element;
        if (el.matches?.(REGION_SELECTOR)) {
          const state = regions.get(el) ?? register(el, true);
          if (state) touched.add(state);
        } else {
          unregister(el);
        }
        continue;
      }

      registerAncestors(target);

      if (mutation.type === 'childList') {
        for (const node of Array.from(mutation.removedNodes)) {
          if (node.nodeType === 1) {
            const el = node as Element;
            if (regions.has(el)) unregister(el);
            for (const nested of Array.from(el.querySelectorAll?.('[aria-live], [role]') ?? [])) {
              unregister(nested);
            }
          }
        }
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === 1) scanSubtree(node as Element, touched);
        }
      }

      const state = nearestRegion(target);
      if (state) touched.add(state);
    }

    for (const state of touched) {
      try {
        flushRegion(state);
      } catch {
        /* never let instrumentation break the page */
      }
    }
  };

  const observer = new win.MutationObserver(handleRecords);

  try {
    observer.observe(doc, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
  } catch {
    /* ignore */
  }

  if (doc.documentElement) scanSubtree(doc.documentElement, new Set());
  else {
    doc.addEventListener(
      'readystatechange',
      () => {
        if (doc.documentElement) scanSubtree(doc.documentElement, new Set());
      },
      { once: true },
    );
  }

  // ------------------------------------------------------------------ focus

  doc.addEventListener(
    'focusin',
    (event) => {
      const target = event.target as Element | null;
      if (!target || target === doc.body) return;
      record({ type: 'focus-changed', target: labelOf(target) });
    },
    true,
  );

  // ------------------------------------------------------------------- marks

  const mark: ProbeHandle['mark'] = (phase, opts = {}) => {
    // A mark is emitted by the page after its DOM writes, but MutationObserver
    // callbacks run in a later microtask. Flush them first so "the stream ended
    // at T" really is after the last token, not before it.
    try {
      handleRecords(observer.takeRecords());
    } catch {
      /* ignore */
    }

    let answer = opts.id ? answers.find((entry) => entry.id === opts.id) : undefined;

    if (!answer && phase !== 'start') {
      // close the most recent open answer instead of silently opening another
      for (let index = answers.length - 1; index >= 0; index -= 1) {
        const candidate = answers[index];
        if (candidate && candidate.outcome === 'running') {
          answer = candidate;
          break;
        }
      }
    }

    if (!answer) {
      answer = { id: opts.id ?? `a${++answerSeq}`, startedAt: now(), endedAt: null, outcome: 'running' };
      if (opts.detail) answer.detail = opts.detail;
      answers.push(answer);
    }

    if (phase !== 'start') {
      answer.endedAt = now();
      answer.outcome = phase;
      if (opts.detail) answer.detail = opts.detail;
    }

    record({ type: 'mark', phase, answerId: answer.id, ...(opts.detail ? { detail: opts.detail } : {}) });
  };

  const snapshot: ProbeHandle['snapshot'] = () => ({
    version: PROBE_VERSION,
    url: doc.location?.href ?? '',
    userAgent: win.navigator?.userAgent ?? '',
    startedAt: 0,
    capturedAt: now(),
    events: events.slice(),
    answers: answers.map((entry) => ({ ...entry })),
    ariaNotify: {
      native: implAtInstall === 'native',
      pageProvided: implIsPage,
    },
    regions: Array.from(regions.values()).map((state) => ({ ...state.info })),
  });

  const handle: ProbeHandle = {
    version: PROBE_VERSION,
    mark,
    snapshot,
    reset: () => {
      events = [];
      seq = 0;
      answers.length = 0;
      answerSeq = 0;
      regions.clear();
      if (doc.documentElement) scanSubtree(doc.documentElement, new Set());
    },
    regions: () => Array.from(regions.values()).map((state) => ({ ...state.info })),
    now,
  };

  const markReady = (): void => {
    try {
      doc.documentElement?.setAttribute('data-livesay-probe', 'ready');
    } catch {
      /* ignore */
    }
  };
  markReady();
  doc.addEventListener('DOMContentLoaded', markReady, { once: true });

  globalRef.__livesayProbe = handle;
  return handle;
}
