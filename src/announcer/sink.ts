/**
 * Where announcements leave the app.
 *
 * `ariaNotify()` when the browser has it (Baseline 2026), a visually hidden live
 * region when it does not — one contract, two mechanisms, chosen at runtime.
 * Tests inject `createMemorySink()` and assert on the same interface.
 */

export interface AnnouncementSink {
  announce(text: string, options: { priority: 'normal' | 'high' }): void;
  dispose?(): void;
  /** Which mechanism is in use, for the report and for debugging. */
  readonly kind?: 'aria-notify' | 'live-region' | 'memory';
}

export interface AnnouncedMessage {
  text: string;
  priority: 'normal' | 'high';
  at: number;
}

/** Deterministic sink for tests and for server rendering checks. */
export function createMemorySink(now: () => number = () => Date.now()): AnnouncementSink & {
  messages: AnnouncedMessage[];
} {
  const messages: AnnouncedMessage[] = [];
  return {
    kind: 'memory',
    messages,
    announce(text, options) {
      messages.push({ text, priority: options.priority, at: now() });
    },
  };
}

const HIDDEN_STYLE = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'margin:-1px',
  'padding:0',
  'border:0',
  'overflow:hidden',
  'clip-path:inset(50%)',
  'white-space:nowrap',
].join(';');

export interface DomSinkOptions {
  document?: Document;
  window?: Window;
  /** Prefix for the live regions' ids. */
  idPrefix?: string;
  /** How long to hold identical text before repeating it. */
  repeatGapMs?: number;
}

/**
 * A live-region sink that behaves the way screen readers expect:
 * - `polite` for progress, `assertive` for errors, never both at once
 * - `aria-relevant="additions text"` so clearing the node is not announced
 * - a changed string for a repeated message (ATs ignore an identical rewrite)
 */
export function createDomSink(options: DomSinkOptions = {}): AnnouncementSink {
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) throw new Error('createDomSink() needs a document; pass one or use createMemorySink().');

  const win = options.window ?? doc.defaultView ?? undefined;
  const prefix = options.idPrefix ?? 'livesay';
  const repeatGapMs = options.repeatGapMs ?? 250;

  const nativeNotify = typeof win?.ariaNotify === 'function' ? win.ariaNotify.bind(win) : undefined;
  if (nativeNotify) {
    return {
      kind: 'aria-notify',
      announce(text, { priority }) {
        if (!text.trim()) return;
        try {
          nativeNotify(text, { priority });
        } catch {
          /* never break the app for an announcement */
        }
      },
    };
  }

  const nodes: Partial<Record<'normal' | 'high', HTMLElement>> = {};
  const lastText: Partial<Record<'normal' | 'high', string>> = {};
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const ensureNode = (priority: 'normal' | 'high'): HTMLElement | null => {
    const existing = nodes[priority];
    if (existing?.isConnected) return existing;
    const body = doc.body;
    if (!body) return null;
    const node = doc.createElement('div');
    node.id = `${prefix}-${priority === 'high' ? 'assertive' : 'polite'}`;
    node.setAttribute('role', priority === 'high' ? 'alert' : 'status');
    node.setAttribute('aria-live', priority === 'high' ? 'assertive' : 'polite');
    node.setAttribute('aria-atomic', 'true');
    node.setAttribute('aria-relevant', 'additions text');
    node.setAttribute('style', HIDDEN_STYLE);
    body.appendChild(node);
    nodes[priority] = node;
    return node;
  };

  const write = (priority: 'normal' | 'high', text: string): void => {
    const node = ensureNode(priority);
    if (!node) return;
    const previous = lastText[priority];
    const deliver = (): void => {
      if (disposed) return;
      node.textContent = text;
    };
    if (previous && previous === text) {
      node.textContent = '';
      const timer = setTimeout(() => {
        timers.delete(timer);
        deliver();
      }, repeatGapMs);
      timers.add(timer);
    } else {
      deliver();
    }
    lastText[priority] = text;
  };

  return {
    kind: 'live-region',
    announce(text, { priority }) {
      if (disposed) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      write(priority, trimmed);
    },
    dispose() {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const node of Object.values(nodes)) node?.remove();
    },
  };
}
