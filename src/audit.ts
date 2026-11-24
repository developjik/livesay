/**
 * Audit orchestration: one recording in, one report out.
 *
 * `audit()` is pure — it takes a ProbeSnapshot and returns a report — so it can
 * run over a live browser capture, a saved snapshot.json, or a fixture in a
 * unit test.
 */

import type { BaselineComparison } from './baseline.js';
import { PROBE_VERSION } from './probe/runtime.js';
import { checkBudget, type BudgetResult } from './budget.js';
import {
  DEFAULT_RULE_OPTIONS,
  collectMetrics,
  findAssertiveAbuse,
  findDuplicates,
  findPartials,
  findSilentAbort,
  findSilentCompletion,
  findTokenStorm,
  type Finding,
  type Metrics,
  type ResolvedRuleOptions,
} from './rules.js';
import { PROFILES, simulate, type ProfileName, type Simulation } from './simulate.js';
import type { ProbeSnapshot, RegionInfo, Utterance } from './types.js';

export const VERSION = PROBE_VERSION;

export interface AuditOptions {
  profile?: ProfileName;
  rules?: Partial<ResolvedRuleOptions>;
  /** `announcements<8,words/min<180,no-partial` */
  budget?: string;
}

export interface AnswerAudit {
  id: string;
  outcome: ProbeSnapshot['answers'][number]['outcome'];
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  utterances: number;
  words: number;
  completionAnnounced: boolean | null;
}

export type Verdict = 'pass' | 'warn' | 'fail';

export interface AuditReport {
  tool: { name: 'livesay'; version: string };
  target: {
    url: string;
    capturedAt: string;
    probeVersion: string;
    ariaNotify: ProbeSnapshot['ariaNotify'];
    regions: RegionInfo[];
  };
  profile: ProfileName;
  profileTagline: string;
  options: ResolvedRuleOptions;
  metrics: Metrics;
  answers: AnswerAudit[];
  findings: Finding[];
  utterances: Utterance[];
  budget?: BudgetResult;
  verdict: Verdict;
  /** Present only when a baseline was explicitly supplied. */
  baseline?: BaselineComparison;
  /** Persist custom patterns since native RegExp JSON is empty. */
  rulePatterns?: { completionPattern: { source: string; flags: string }; abortPattern: { source: string; flags: string } };
}

const nowIso = (): string => new Date().toISOString();

function summariseAnswers(snapshot: ProbeSnapshot, simulation: Simulation, options: ResolvedRuleOptions): AnswerAudit[] {
  return snapshot.answers.map((answer) => {
    const relevant = simulation.utterances.filter((utterance) => {
      if (answer.endedAt === null) return utterance.t >= answer.startedAt;
      return utterance.t >= answer.startedAt - 250 && utterance.t <= answer.endedAt + options.completionGraceMs;
    });
    let completionAnnounced: boolean | null = null;
    if (answer.outcome === 'done' && answer.endedAt !== null) {
      completionAnnounced = findSilentCompletion({ ...snapshot, answers: [answer] }, options).length === 0;
    }
    return {
      id: answer.id,
      outcome: answer.outcome,
      startedAt: answer.startedAt,
      endedAt: answer.endedAt,
      durationMs: answer.endedAt === null ? null : Math.max(0, answer.endedAt - answer.startedAt),
      utterances: relevant.length,
      words: relevant.reduce((total, utterance) => total + utterance.words, 0),
      completionAnnounced,
    };
  });
}

export function audit(snapshot: ProbeSnapshot, options: AuditOptions = {}): AuditReport {
  const profile = options.profile && PROFILES[options.profile] ? options.profile : 'nvda-like';
  const rules: ResolvedRuleOptions = { ...DEFAULT_RULE_OPTIONS, ...options.rules };
  const simulation = simulate(snapshot, profile);

  const findings: Finding[] = [
    ...findTokenStorm(snapshot, rules),
    ...findSilentCompletion(snapshot, rules),
    ...findSilentAbort(snapshot, rules),
    ...findAssertiveAbuse(simulation, rules),
    ...findDuplicates(simulation, rules),
    ...findPartials(simulation, rules),
  ].slice(0, rules.maxFindings);

  const metrics = collectMetrics(snapshot, simulation, rules);
  const budget = options.budget ? checkBudget(options.budget, metrics, findings) : undefined;

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warns = findings.filter((finding) => finding.severity === 'warn').length;
  const verdict: Verdict =
    errors > 0 || (budget && !budget.passed) ? 'fail' : warns > 0 ? 'warn' : 'pass';

  return {
    tool: { name: 'livesay', version: VERSION },
    target: {
      url: snapshot.url,
      capturedAt: nowIso(),
      probeVersion: snapshot.version,
      ariaNotify: snapshot.ariaNotify,
      regions: snapshot.regions,
    },
    profile,
    profileTagline: PROFILES[profile].tagline,
    options: rules,
    ...(options.rules?.completionPattern || options.rules?.abortPattern ? { rulePatterns: { completionPattern: { source: rules.completionPattern.source, flags: rules.completionPattern.flags }, abortPattern: { source: rules.abortPattern.source, flags: rules.abortPattern.flags } } } : {}),
    metrics,
    answers: summariseAnswers(snapshot, simulation, rules),
    findings,
    utterances: simulation.utterances,
    ...(budget ? { budget } : {}),
    verdict,
  };
}
