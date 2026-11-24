/**
 * Reports: a console summary for CI logs, JSON for machines, and one
 * self-contained HTML transcript that answers "what was said, and when".
 */

import { baselineFailed, type BaselineComparison } from './baseline.js';
import type { AuditReport } from './audit.js';
import { formatClock, truncate } from './text.js';
import type { Utterance } from './types.js';

const numberFormat = new Intl.NumberFormat('en-US');

const fmt = (value: number | null | undefined, suffix = ''): string =>
  value === null || value === undefined ? '—' : `${numberFormat.format(value)}${suffix}`;

export function renderJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const pad = (text: string, width: number): string =>
  text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`;

export function renderConsole(report: AuditReport, options: { color?: boolean } = {}): string {
  const color = options.color ?? false;
  const paint = (code: string, text: string): string => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const bold = (text: string): string => paint('1', text);
  const dim = (text: string): string => paint('2', text);
  const lines: string[] = [];

  const verdictLabel =
    report.verdict === 'fail' ? paint('31', 'FAIL') : report.verdict === 'warn' ? paint('33', 'WARN') : paint('32', 'PASS');

  lines.push(`${bold(`livesay ${report.tool.version}`)}  ${report.target.url}`);
  lines.push(
    dim(
      `profile ${report.profile} (simulated) · ${report.metrics.answers} answer(s) · ${fmt(report.metrics.durationMs, 'ms')} · probe ${report.target.probeVersion} · ariaNotify ${report.target.ariaNotify.native ? 'native' : 'fallback'}`,
    ),
  );
  lines.push('');

  const metrics: Array<[string, string]> = [
    ['announcements', fmt(report.metrics.utterances)],
    ['words spoken', fmt(report.metrics.words)],
    ['words/min', fmt(report.metrics.wordsPerMinute)],
    ['peak updates/s', fmt(report.metrics.peakUpdatesPerSecond)],
    ['partial', fmt(report.metrics.partials)],
    ['duplicate', fmt(report.metrics.duplicates)],
    ['assertive', fmt(report.metrics.assertive)],
    ['replaced', fmt(report.metrics.replaced)],
    ['completion', report.metrics.completionAnnounced === null ? 'unmarked' : report.metrics.completionAnnounced ? 'announced' : 'silent'],
    ['verdict', verdictLabel],
  ];

  for (let i = 0; i < metrics.length; i += 2) {
    const left = metrics[i];
    const right = metrics[i + 1];
    if (!left) continue;
    const cell = `${dim(pad(left[0], 16))}${pad(left[1], 22)}`;
    const cell2 = right ? `${dim(pad(right[0], 16))}${right[1]}` : '';
    lines.push(`${cell}${cell2}`.trimEnd());
  }

  lines.push('');
  if (report.findings.length === 0) {
    lines.push(`${paint('32', 'ok')}  no rule violations`);
  } else {
    for (const finding of report.findings) {
      const marker = finding.severity === 'error' ? paint('31', 'error') : paint('33', 'warn ');
      lines.push(`${marker}  ${bold(finding.title)}  ${dim(`[${finding.rule}]`)}`);
      lines.push(`       ${finding.message}`);
      lines.push(`       ${dim('→')} ${finding.suggestion}`);
      const sample = finding.evidence.sample ?? finding.evidence.partials ?? finding.evidence.repeats;
      if (Array.isArray(sample) && sample.length > 0) {
        for (const item of sample.slice(0, 3)) {
          const text =
            typeof item === 'string'
              ? item
              : typeof item === 'object' && item !== null
                ? String(
                    (item as { text?: string; first?: string; then?: string }).text ??
                      `${(item as { first?: string }).first ?? ''} → ${(item as { then?: string }).then ?? ''}`,
                  )
                : String(item);
          lines.push(`       ${dim('·')} ${truncate(text, 110)}`);
        }
      }
      lines.push('');
    }
  }

  if (report.budget) {
    lines.push(
      `${report.budget.passed ? paint('32', 'budget ok') : paint('31', 'budget failed')}  ${dim(report.budget.spec)}`,
    );
    for (const check of report.budget.checks) {
      const mark = check.ok ? paint('32', '✓') : paint('31', '✗');
      const actual =
        check.actual === null ? (check.detail ?? '—') : typeof check.actual === 'boolean' ? String(check.actual) : numberFormat.format(check.actual);
      lines.push(`  ${mark} ${pad(check.expectation, 28)} ${actual}`);
    }
    lines.push('');
  }

  if (report.baseline) lines.push(renderComparisonConsole(report.baseline));

  const spoken = report.utterances.slice(0, 8);
  if (spoken.length > 0) {
    lines.push(dim('first announcements'));
    for (const utterance of spoken) {
      const flags = [
        utterance.priority === 'high' ? 'assertive' : '',
        utterance.interrupted ? 'interrupted' : '',
        utterance.replaced ? `replaced:${utterance.replaced}` : '',
        utterance.folded ? `folded:${utterance.folded}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `  ${dim(formatClock(utterance.t))}  ${pad(utterance.source === 'aria-notify' ? 'notify' : (utterance.regionId ?? 'region'), 9)} ${truncate(utterance.text, 96)}${flags ? dim(`  (${flags})`) : ''}`,
      );
    }
    if (report.utterances.length > spoken.length) {
      lines.push(dim(`  … ${report.utterances.length - spoken.length} more in the HTML/JSON report`));
    }
    lines.push('');
  }

  lines.push(`${bold(verdictLabel)}  ${report.target.url}`);
  return lines.join('\n');
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const CSS = `
:root {
  color-scheme: dark;
  --bg: #0a0b0d;
  --panel: #12141a;
  --panel-2: #171a21;
  --line: #23272f;
  --text: #e9eaee;
  --muted: #8d939e;
  --faint: #5f6570;
  --pass: #3dd68c;
  --warn: #f5a524;
  --fail: #ec5f67;
  --accent: #7aa2f7;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 40px 28px 72px; }
.masthead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.brand { font: 600 15px/1 var(--mono); letter-spacing: .04em; }
.brand span { color: var(--faint); font-weight: 400; margin-left: 8px; }
.verdict { font: 600 12px/1 var(--mono); letter-spacing: .14em; padding: 8px 12px; border: 1px solid currentColor; border-radius: 2px; }
.verdict--pass { color: var(--pass); }
.verdict--warn { color: var(--warn); }
.verdict--fail { color: var(--fail); }
h1 { font-size: 20px; font-weight: 550; margin: 26px 0 6px; letter-spacing: -.01em; }
.target { font: 13px/1.5 var(--mono); color: var(--muted); word-break: break-all; margin: 0 0 4px; }
.meta { font: 12px/1.6 var(--mono); color: var(--faint); margin: 0 0 28px; }
h2 { font: 600 11px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin: 36px 0 14px; }
.hero { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); }
.hero > div { background: var(--panel); padding: 18px 16px; }
.hero .n { font: 500 30px/1.1 var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.hero .n small { font-size: 13px; color: var(--faint); margin-left: 4px; }
.hero .k { font: 500 11px/1 var(--mono); letter-spacing: .08em; color: var(--muted); text-transform: uppercase; margin-top: 10px; }
.hero .bad { color: var(--fail); }
.hero .good { color: var(--pass); }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.cell { background: var(--panel); border: 1px solid var(--line); padding: 14px 14px 12px; }
.cell .v { font: 500 18px/1.2 var(--mono); font-variant-numeric: tabular-nums; }
.cell .k { font: 500 10px/1 var(--mono); letter-spacing: .1em; color: var(--muted); text-transform: uppercase; margin-top: 8px; }
.cell .s { font-size: 12px; color: var(--faint); margin-top: 6px; }
.findings { display: grid; gap: 12px; }
.finding { background: var(--panel); border: 1px solid var(--line); border-left-width: 3px; padding: 16px 18px; }
.finding--error { border-left-color: var(--fail); }
.finding--warn { border-left-color: var(--warn); }
.finding h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.finding h3 code { font: 400 11px/1 var(--mono); color: var(--faint); margin-left: 8px; }
.finding p { margin: 0 0 10px; color: var(--text); }
.finding p.msg { color: #cfd3db; }
.finding p.fix { color: var(--muted); font-size: 13px; }
.finding p.fix b { color: var(--accent); font-weight: 500; }
.evidence { font: 12px/1.5 var(--mono); color: var(--muted); background: var(--bg); border: 1px solid var(--line); padding: 10px 12px; margin: 10px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
table { width: 100%; border-collapse: collapse; font: 12.5px/1.5 var(--mono); }
thead th { text-align: left; font: 500 10px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 0 10px 8px 0; border-bottom: 1px solid var(--line); }
tbody td { padding: 7px 10px 7px 0; border-bottom: 1px solid #1a1d24; vertical-align: top; }
tbody tr:hover td { background: #10131a; }
td.t { color: var(--faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
td.src { color: var(--muted); white-space: nowrap; }
td.txt { color: #d9dce3; }
td.flags { white-space: nowrap; }
.tag { display: inline-block; font: 500 10px/1 var(--mono); letter-spacing: .06em; padding: 4px 6px; border: 1px solid var(--line); color: var(--muted); margin-right: 4px; text-transform: uppercase; }
.tag--assertive { color: var(--warn); border-color: #4a3413; }
.tag--interrupted { color: var(--fail); border-color: #4a2026; }
.tag--replaced { color: var(--faint); }
.budget { display: grid; gap: 6px; font: 12.5px/1.6 var(--mono); }
.budget .row { display: grid; grid-template-columns: 28px 1fr 120px; gap: 8px; align-items: baseline; }
.budget .ok { color: var(--pass); }
.budget .no { color: var(--fail); }
.empty { color: var(--muted); font-size: 13px; }
footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--faint); font-size: 12px; line-height: 1.7; }
@media (max-width: 760px) {
  .hero, .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wrap { padding: 24px 16px 56px; }
}
`;

function utteranceFlags(utterance: Utterance): string {
  const flags: string[] = [];
  if (utterance.priority === 'high') flags.push('<span class="tag tag--assertive">assertive</span>');
  if (utterance.interrupted) flags.push('<span class="tag tag--interrupted">interrupted</span>');
  if (utterance.replaced) flags.push(`<span class="tag tag--replaced">replaced:${escapeHtml(utterance.replaced)}</span>`);
  if (utterance.folded) flags.push(`<span class="tag tag--replaced">folded:${utterance.folded}</span>`);
  return flags.join('');
}

export function renderHtml(report: AuditReport): string {
  const m = report.metrics;
  const verdictClass = report.verdict === 'fail' ? 'fail' : report.verdict === 'warn' ? 'warn' : 'pass';

  const hero = `
    <div>
      <div class="n ${m.utterances > 30 ? 'bad' : 'good'}">${fmt(m.utterances)}<small>announcements</small></div>
      <div class="k">what the listener heard</div>
    </div>
    <div>
      <div class="n ${m.wordsPerMinute !== null && m.wordsPerMinute > 180 ? 'bad' : ''}">${fmt(m.wordsPerMinute)}<small>words/min</small></div>
      <div class="k">speech rate</div>
    </div>
    <div>
      <div class="n ${m.peakUpdatesPerSecond > 4 ? 'bad' : ''}">${fmt(m.peakUpdatesPerSecond)}<small>/s</small></div>
      <div class="k">peak live-region updates</div>
    </div>
    <div>
      <div class="n ${m.completionAnnounced === false ? 'bad' : m.completionAnnounced ? 'good' : ''}">${
        m.completionAnnounced === null ? '—' : m.completionAnnounced ? 'yes' : 'no'
      }</div>
      <div class="k">completion announced</div>
    </div>`;

  const cells: Array<[string, string, string]> = [
    ['spoken words', fmt(m.words), 'words in the utterance timeline'],
    ['partial', fmt(m.partials), 'sentences cut and re-read'],
    ['duplicate', fmt(m.duplicates), 'passages spoken twice'],
    ['assertive', fmt(m.assertive), `limit suggested: ${report.options.assertiveLimit}`],
    ['interruptions', fmt(m.interruptions), 'polite speech cut off'],
    ['replaced', fmt(m.replaced), 'announcements dropped before speech'],
    ['deferred (aria-busy)', fmt(m.deferred), 'updates suppressed while busy'],
    ['live regions', fmt(report.target.regions.length), 'regions found in the page'],
  ];

  const findingHtml =
    report.findings.length === 0
      ? '<p class="empty">No rule violations. The answer was announced in complete sentences and its end was signalled.</p>'
      : report.findings
          .map((finding) => {
            const evidence = escapeHtml(JSON.stringify(finding.evidence, null, 2));
            return `<article class="finding finding--${finding.severity}">
        <h3>${escapeHtml(finding.title)}<code>${escapeHtml(finding.rule)}</code></h3>
        <p class="msg">${escapeHtml(finding.message)}</p>
        <p class="fix"><b>Fix →</b> ${escapeHtml(finding.suggestion)}</p>
        <pre class="evidence">${evidence}</pre>
      </article>`;
          })
          .join('\n');

  const budgetHtml = report.budget
    ? `<h2>Budget</h2>
    <div class="budget">
      ${report.budget.checks
        .map((check) => {
          const actual =
            check.actual === null
              ? (check.detail ?? '—')
              : typeof check.actual === 'boolean'
                ? String(check.actual)
                : numberFormat.format(check.actual);
          return `<div class="row"><span class="${check.ok ? 'ok' : 'no'}">${check.ok ? '✓' : '✗'}</span><span>${escapeHtml(check.expectation)}</span><span>${escapeHtml(actual)}</span></div>`;
        })
        .join('')}
      <div class="row"><span class="${report.budget.passed ? 'ok' : 'no'}">${report.budget.passed ? '✓' : '✗'}</span><span>${escapeHtml(report.budget.spec)}</span><span>${report.budget.passed ? 'pass' : 'fail'}</span></div>
    </div>`
    : '';

  const rows =
    report.utterances.length === 0
      ? '<tr><td colspan="4" class="empty">Nothing was announced during the recording.</td></tr>'
      : report.utterances
          .map(
            (utterance) => `<tr>
        <td class="t">${formatClock(utterance.t)}</td>
        <td class="src">${escapeHtml(utterance.source === 'aria-notify' ? 'notify' : (utterance.regionId ?? 'region'))}</td>
        <td class="txt">${escapeHtml(utterance.text)}</td>
        <td class="flags">${utteranceFlags(utterance)}</td>
      </tr>`,
          )
          .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>livesay — ${escapeHtml(report.target.url)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div class="brand">livesay<span>${escapeHtml(report.tool.version)}</span></div>
    <div class="verdict verdict--${verdictClass}">${report.verdict.toUpperCase()}</div>
  </header>

  <h1>What this answer says to a screen reader</h1>
  <p class="target">${escapeHtml(report.target.url)}</p>
  <p class="meta">profile ${escapeHtml(report.profile)} — ${escapeHtml(report.profileTagline)}<br>
  ${escapeHtml(report.target.capturedAt)} · ${report.metrics.answers} answer marker(s) · ariaNotify ${report.target.ariaNotify.native ? 'native' : report.target.ariaNotify.pageProvided ? 'page polyfill' : 'absent (live-region fallback)'} · probe ${escapeHtml(report.target.probeVersion)}</p>

  <div class="hero">${hero}</div>

  <h2>Measurements</h2>
  <div class="grid">
    ${cells
      .map(
        ([label, value, sub]) => `<div class="cell"><div class="v">${escapeHtml(value)}</div><div class="k">${escapeHtml(label)}</div><div class="s">${escapeHtml(sub)}</div></div>`,
      )
      .join('')}
  </div>

  <h2>Findings</h2>
  <div class="findings">${findingHtml}</div>

  ${budgetHtml}
  ${report.baseline ? renderBaselineSection(report.baseline) : ''}

  <h2>Utterance timeline <span style="color:var(--faint);letter-spacing:0;text-transform:none">(${report.utterances.length})</span></h2>
  <table>
    <thead><tr><th style="width:86px">time</th><th style="width:90px">source</th><th>announced text</th><th style="width:200px">flags</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <footer>
    Announcements are simulated under the “${escapeHtml(report.profile)}” profile: real screen readers differ in how they queue, coalesce and interrupt.
    This report measures an announcement contract — completeness, pacing, duplicates, completion — and is not a WCAG conformance claim.
    Recorded by livesay ${escapeHtml(report.tool.version)}; the same recording can be replayed under <code>voiceover-like</code> and <code>spec-strict</code>.
  </footer>
</div>
</body>
</html>
`;
}

/** Preserve every selected profile while keeping single-report formats stable. */
export function reportsFailed(reports: AuditReport[], strict = false): boolean {
  return reports.some(report => report.baseline ? baselineFailed(report.baseline, strict) : report.findings.some(finding => finding.severity === 'error' || (strict && finding.severity === 'warn')) || (report.budget ? !report.budget.passed : false));
}

export function renderReportsJson(reports: AuditReport[]): string {
  return `${JSON.stringify({ schema: 'livesay.profiles/v1', reports }, null, 2)}\n`;
}

export function renderReportsHtml(reports: AuditReport[]): string {
  const sections = reports.map(report => `<section><h2>${escapeHtml(report.profile)}: ${escapeHtml(report.verdict.toUpperCase())}</h2><iframe title="${escapeHtml(report.profile)} audit report" srcdoc="${escapeHtml(renderHtml(report))}"></iframe></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>livesay: all profiles</title><style>body{margin:0;padding:24px;background:#0e1116;color:#e8eef5;font:16px system-ui}main{max-width:1200px;margin:auto}h1{font-size:28px}h2{font-size:20px}section{margin:24px 0 40px}iframe{width:100%;height:900px;border:1px solid #374151;border-radius:12px;background:white;box-sizing:border-box}</style></head><body><main><h1>livesay: all profiles</h1><p>All selected simulated profiles. Each report keeps its findings, budget and transcript.</p>${sections}</main></body></html>\n`;
}


export function renderComparisonConsole(comparison: BaselineComparison): string {
  const f = (value: number | null): string => value === null ? 'n/a' : String(value);
  return [
    `Baseline (${comparison.profile}): ${comparison.added.length} new, ${comparison.resolved.length} resolved, ${comparison.unchanged.length} unchanged`,
    ...comparison.metrics.map(row => `${row.metric}: ${f(row.before)} -> ${f(row.after)} (delta ${f(row.delta)})`),
    ...comparison.added.map(item => `NEW ${item.severity} ${item.rule} ${item.target}`),
    ...comparison.resolved.map(item => `RESOLVED ${item.rule} ${item.target}`),
    ...comparison.unchanged.map(item => `UNCHANGED ${item.rule} ${item.target}`),
    ...comparison.newBudgetFailures.map(item => `NEW budget failure: ${item}`),
  ].join('\n');
}

export function renderBaselineSection(comparison: BaselineComparison): string {
  const rows = comparison.metrics.map(row => `<tr><td>${escapeHtml(row.metric)}</td><td>${fmt(row.before)}</td><td>${fmt(row.after)}</td><td>${fmt(row.delta)}</td></tr>`).join('');
  const groups = ([['New', comparison.added], ['Resolved', comparison.resolved], ['Unchanged', comparison.unchanged]] as const).map(([name, items]) => `<h3>${name} (${items.length})</h3><ul>${items.length ? items.map(item => `<li>${escapeHtml(item.severity)}: ${escapeHtml(item.rule)} / ${escapeHtml(item.target)}</li>`).join('') : '<li>None</li>'}</ul>`).join('');
  return `<section aria-label="Baseline" style="overflow-wrap:anywhere"><h2>Baseline</h2><p>Profile ${escapeHtml(comparison.profile)}. Baseline findings are still listed in the audit, but only new failures gate this run.</p><p class="target">Before: ${escapeHtml(comparison.baselineUrl)}<br>After: ${escapeHtml(comparison.currentUrl)}</p><div style="overflow-x:auto"><table><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Delta</th></tr></thead><tbody>${rows}</tbody></table></div>${groups}<p>New budget failures: ${comparison.newBudgetFailures.map(escapeHtml).join(', ') || 'none'}</p></section>`;
}

export function renderComparisonHtml(comparison: BaselineComparison): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>livesay baseline comparison</title><style>${CSS}</style></head><body><main class="wrap"><h1>livesay comparison</h1>${renderBaselineSection(comparison)}<footer>Simulated announcement contract, not a WCAG conformance claim.</footer></main></body></html>\n`;
}


export function renderComparisonsHtml(comparisons: BaselineComparison[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>livesay baseline comparisons</title><style>${CSS}</style></head><body><main class="wrap"><h1>livesay comparisons</h1>${comparisons.map(renderBaselineSection).join('')}</main></body></html>\n`;
}
