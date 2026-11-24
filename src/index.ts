/**
 * livesay — measure what a streaming AI answer says to a screen reader, then
 * say it better.
 *
 *   import { installProbe, readProbeSnapshot, audit, renderHtml } from 'livesay';
 *   import { createStreamingAnnouncer } from 'livesay';
 */

export { VERSION, audit, type AuditOptions, type AuditReport, type AnswerAudit, type Verdict } from './audit.js';
export {
  checkBudget,
  parseBudget,
  BudgetError,
  type BudgetCheck,
  type BudgetResult,
} from './budget.js';
export { capture, type CaptureOptions, type CaptureResult } from './capture.js';
export { installProbe, probeRuntimeSource, readProbeSnapshot, waitForAnswer } from './probe/install.js';
export { markAnswer } from './probe/mark.js';
export type { MinimalPage } from './probe/install.js';
export { PROBE_VERSION, installProbeRuntime, type ProbeHandle } from './probe/runtime.js';
export { renderConsole, renderHtml, renderJson } from './report.js';
export {
  DEFAULT_RULE_OPTIONS,
  collectMetrics,
  findAssertiveAbuse,
  findDuplicates,
  findPartials,
  findSilentAbort,
  findSilentCompletion,
  findTokenStorm,
  hasCompletionSignal,
  peakInWindow,
  type Finding,
  type Metrics,
  type ResolvedRuleOptions,
  type RuleId,
  type Severity,
} from './rules.js';
export { PROFILES, PROFILE_NAMES, simulate, type Profile, type ProfileName, type Simulation } from './simulate.js';
export { startServer, type DemoServer } from './server.js';
export {
  countWords,
  endsMidSentence,
  formatClock,
  formatMs,
  isStrictPrefix,
  normalizeForCompare,
  truncate,
} from './text.js';
export type {
  AnnouncementSource,
  AnswerPhase,
  AnswerRecord,
  MarkEvent,
  NotifyEvent,
  Politeness,
  Priority,
  ProbeEvent,
  ProbeSnapshot,
  RegionInfo,
  Utterance,
} from './types.js';

export {
  createStreamingAnnouncer,
  type AnnouncerPhase,
  type AnnouncerState,
  type StreamingAnnouncer,
  type StreamingAnnouncerOptions,
} from './announcer/core.js';
export {
  createDomSink,
  createMemorySink,
  type AnnouncementSink,
  type AnnouncedMessage,
  type DomSinkOptions,
} from './announcer/sink.js';
export { splitAtBoundary, takeCompleteSentences, type SplitResult } from './announcer/sentences.js';

export { compareReports, baselineFailed, readAuditReports, type BaselineComparison, type FindingChange, type MetricDelta } from './baseline.js';
export { renderComparisonConsole, renderComparisonHtml } from './report.js';
