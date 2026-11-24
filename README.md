# livesay

**Your server counts tokens. livesay counts ears.**

A screen reader does not read a streaming answer — it reacts to every DOM update that lands in a live
region or an `ariaNotify()` call. Stream token by token into `aria-live` and the listener gets a
stutter of half-words that never finishes, and then silence instead of "the answer is done".

livesay records what a page actually announced, simulates what a screen reader would say, and turns
it into numbers you can put in CI: announcements, words per minute, partials, duplicates, assertive
interrupts, and whether the end was announced at all.

[![CI](https://github.com/developjik/livesay/actions/workflows/ci.yml/badge.svg)](https://github.com/developjik/livesay/actions/workflows/ci.yml)

[한국어 README](README.ko.md) · MIT · Node 20+

```bash
npx playwright install chromium
npx livesay audit http://localhost:3000/chat --html report.html
```

```
announcements   7     words/min       296     peak updates/s  36
partial         0     assertive       2       completion      silent
error  Token-by-token chatter [token-storm]
       p#answer was rewritten 36 times within 1000ms (78 updates total).
error  Answer ended without a completion announcement [silent-completion]
```

---

## The bug, in one measurement

The same 78-word answer, streamed at the same speed, read by the same simulated screen reader
(profile `nvda-like`):

| | naive streaming | with `createStreamingAnnouncer` |
|---|---|---|
| live-region updates | **78** | 2 |
| peak updates / second | **36** | 2 |
| announcements | 7 | **4** |
| completion announced | **no** | **yes** |
| findings | 3 errors | none |

Both pages ship in this repo (`demo/bad.html`, `demo/good.html`), and the behaviour behind these
numbers — a token storm, a bounded announcement set, a missing completion signal — is asserted on
every CI run.

## Try it in a minute

```bash
git clone https://github.com/developjik/livesay.git
cd livesay
npm install
npx playwright install chromium
npm run build

node dist/cli.js serve            # http://127.0.0.1:4319
# in a second shell
node dist/cli.js audit http://127.0.0.1:4319/bad.html --html report.html
node dist/cli.js audit http://127.0.0.1:4319/good.html --budget "announcements<8,no-partial,no-silent"
```

`bad.html` exits **1**, `good.html` exits **0**. The HTML report is a timeline of what a listener
would have heard, when, and what went wrong.

## What it measures

Every number is about speech, not about the DOM:

| metric | meaning |
|---|---|
| `announcements` | separate utterances a listener would hear |
| `words/min` | words that must be spoken per minute of generation — above ~180 the announcer is permanently behind |
| `peak updates/s` | the densest second of live-region rewrites |
| `partial` | utterances cut mid-sentence and then re-read from the start |
| `duplicate` | the same passage spoken twice inside the window |
| `assertive` | interruptions; more than one per answer fights the listener |
| `replaced` | announcements dropped before they were spoken |
| `deferred (aria-busy)` | updates suppressed because the region was busy |
| `completion` | was the end of the answer announced? |

## Rules

| rule | severity | fires when |
|---|---|---|
| `token-storm` | error | a live region (or `ariaNotify`) is updated ≥5 times in one second |
| `silent-completion` | error | the stream ended and nothing announced it |
| `silent-abort` | error | the stream stopped or failed and the page went quiet |
| `assertive-abuse` | error | more than one assertive announcement per answer |
| `duplicate-announcement` | warn | the same passage spoken twice inside the window |
| `partial-announcement` | warn | an utterance is a truncated prefix of the next |

Rules are contracts, not a WCAG verdict: "announce the end", "don't re-announce every token", "one
assertive moment per answer".

## Three screen readers, one recording

No AT is a reference implementation, so the recording is replayed under three profiles and the report
always says **simulated**:

| profile | behaviour |
|---|---|
| `nvda-like` (default) | polite speech coalesces inside a 250 ms burst; assertive interrupts |
| `voiceover-like` | every polite update queues; slower speech (300 ms/word) |
| `spec-strict` | queues everything and restarts an atomic region from the top |

```bash
node dist/cli.js audit http://127.0.0.1:4319/bad.html --profile all
```

```
profile         announcements  words/min  updates/s  partial  dup  assertive  verdict
nvda-like       7              301        36         0        0    2          FAIL
voiceover-like  30             929        36         0        0    2          FAIL
spec-strict     31             956        36         0        0    2          FAIL
```

The spread is the point: a page that "seems fine" on one AT is unlistenable on another.

## The fix

```ts
import { createStreamingAnnouncer, markAnswer } from 'livesay';

const announcer = createStreamingAnnouncer({
  minIntervalMs: 600,      // space announcements out
  maxAnnouncements: 2,     // speech cannot keep up with tokens: announce the opening
});                        // then stay quiet and let the reader read

markAnswer('start');

for await (const delta of stream) {
  el.append(delta);        // visible answer, NOT a live region
  announcer.push(delta);   // buffered until a sentence boundary
}

markAnswer('done');        // the stream ended — the moment livesay audits
announcer.done();          // "Answer complete. 78 words."
```

```tsx
import { useStreamingAnnouncer } from 'livesay/react';

function Answer() {
  const say = useStreamingAnnouncer({ maxAnnouncements: 2 });
  // say.push(delta) … say.done() … say.error(reason)
  return <article aria-busy={streaming} aria-label="Answer" ref={ref} />;
}
```

What it does, and refuses to do:

- **sentence boundaries**, not tokens — a chunk is spoken only when it is a complete thought
- **spacing** — `minIntervalMs` between polite announcements
- **a completion message** — one call, not two, because two rapid announcements get coalesced or dropped
- **assertive only for errors** — `error()` and `abort()` interrupt, status does not
- **one ending, ever** — the first of `done()`/`abort()`/`error()` wins; a `done()` after an abort
  cannot announce a bogus completion, and a new answer starts only after `reset()`
- **`ariaNotify()` where it exists, a hidden live region where it does not** — the same interface, and
  feature detection stays honest: the probe never pretends `ariaNotify` exists in a browser that lacks it
- **a cap** — `maxAnnouncements` stops the page from narrating 78 words in 3.5 seconds

Pair it with `aria-busy="true"` on the answer container while streaming: ATs hold their tongue, and the
text is still there to read afterwards.

## In CI

```yaml
- name: Accessibility budget for streaming answers
  run: |
    npx playwright install --with-deps chromium
    npm run build
    node dist/cli.js audit http://127.0.0.1:4319/good.html \
      --budget "announcements<8,words/min<400,no-partial,no-duplicate,no-silent"
```

Budget keys: `announcements<8`, `words<120`, `words/min<180`, `updates/s<20`, `assertive<=1`,
`no-partial`, `no-duplicate`, `no-silent`, `no-errors`, `no-warnings`. Exit code `1` on any violation.

## CLI

```
livesay audit <url> [options]
  --profile <name|all>   nvda-like | voiceover-like | spec-strict | all
  --budget <spec>        speech budget for CI
  --json <path>          machine-readable report ("-" for stdout)
  --html <path>          self-contained transcript report
  --out <dir>            write report.json and report.html
  --timeout <ms>         wait budget for the end mark (default 30000)
  --grace <ms>           keep recording after the end mark (default 1200)
  --wait-for <selector>  wait for an element before waiting for the end mark
  --headed               watch the browser
  --strict               warnings fail the run

livesay serve [--port 4319]   the demo site
livesay rules                 the rule table
```

### Marking the answer

"The answer finished" is not observable from the DOM, so the page says so:

```ts
import { markAnswer } from 'livesay';

markAnswer('start');
// … stream …
markAnswer('done');    // or 'abort' / 'error'
```

`markAnswer` is a no-op when the probe is not installed, so the same code runs in production and under
audit. Mark **before** you announce the completion — the audit asks "did anything reach the listener
after the stream ended?".

Pages that never call it still get audited for `token-storm`, `assertive-abuse`, duplicates and
partials; the silence rules are skipped and the report says `completion: unmarked`.

## Library API

```ts
import {
  installProbe, readProbeSnapshot, audit,
  simulate, PROFILES, checkBudget, renderHtml, renderJson,
  createStreamingAnnouncer, createMemorySink,
} from 'livesay';

await installProbe(page);                 // before page scripts
const snapshot = await readProbeSnapshot(page);
const report = audit(snapshot, { profile: 'nvda-like', budget: 'announcements<8' });
```

`audit()` is pure: it takes a snapshot and returns a report, so a saved recording can be replayed,
diffed, or asserted in a unit test. `simulate()` gives you just the utterance timeline.

## How it works

```
page ──▶ probe (injected before app code)
          ├─ wraps ariaNotify(), including a polyfill the page installs later
          └─ MutationObserver over aria-live / role=status|alert|log|marquee|timer
             (politeness, aria-atomic, aria-relevant, aria-busy resolved per ARIA)
        │  snapshot: events + timestamps + sequence numbers + answer marks
        ▼
simulator ──▶ utterance timeline under one of three AT profiles
        ▼
rules ──▶ findings ──▶ budget ──▶ exit code
        ▼
report ──▶ console · JSON · HTML transcript
```

The probe never changes layout and never throws into the page. It writes one expando
(`window.__livesayProbe`) and one data attribute the CLI waits on. Ordering is compared by sequence
number, because `mark()` flushes any pending mutations first — a mark and the mutation it flushed can
share a millisecond.

## What this is not

- **Not a WCAG conformance claim.** The report measures an announcement contract — completeness,
  pacing, duplicates, a completion signal. Passing it does not mean passing 4.1.3 or 2.2.2.
- **Not a real screen reader.** Speech timing is simulated, ATs differ, and the profiles are models, not
  recordings of NVDA, VoiceOver or Orca. The report says "simulated" wherever it reports.
- **Not a crawling audit.** It measures one page, one interaction, at runtime — the opposite end from
  axe-core's static scan, and complementary to it.
- **Not token accounting.** `words/min` is words spoken per minute of generation time; it says whether
  speech can keep up, not how many tokens the model emitted.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest: probe rules, simulator, announcer, budgets, reports
npm run test:e2e      # build + playwright: the two demos audited end to end
npm run test:all      # all of it
```

## License

MIT © jungingwon (developjik)

### All-profile output

`--profile all` fails when any selected profile has errors or a failed budget. `--strict` checks warnings in every profile. JSON output uses `{ "schema": "livesay.profiles/v1", "reports": [...] }` and HTML contains each profile in its own transcript frame. Single-profile output is unchanged. With `--json -`, stdout is only JSON and human summaries go to stderr; `--quiet` suppresses those summaries.

## Development baseline (DEV-128)

Use Node.js 22.12.0 (`.nvmrc`) for development and CI. Vitest 5.1.1 requires Node 22.12+ on its supported release lines; Node 20.19 is outside its declared development support range. It may execute there, but CI does not treat that as supported test-runner usage. This development requirement does not change the package engine declaration. Runtime compatibility must be checked using the built package, separately from the test runner. TypeScript 7.0.2 is the development compiler baseline.
