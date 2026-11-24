#!/usr/bin/env node
/**
 * livesay CLI
 *
 *   livesay audit <url> [--profile nvda-like|voiceover-like|spec-strict|all]
 *                       [--budget "announcements<8,words/min<180,no-partial"]
 *                       [--json report.json] [--html report.html] [--out reports/]
 *   livesay serve [--port 4319]      demo site
 *   livesay demo                     build-free alias for serve
 *   livesay rules                    the rule table
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { audit, VERSION, type AuditReport } from './audit.js';
import { BudgetError } from './budget.js';
import { capture } from './capture.js';
import { renderConsole, renderHtml, renderJson, renderReportsHtml, renderReportsJson, reportsFailed } from './report.js';
import { startServer } from './server.js';
import { PROFILES, PROFILE_NAMES, type ProfileName } from './simulate.js';

const HELP = `livesay ${VERSION} — what does your streamed answer say to a screen reader?

Usage
  livesay audit <url> [options]
  livesay serve [--port <n>]     demo site (naive vs livesay)
  livesay rules                  rule table
  livesay --version

Audit options
  --profile <name|all>   nvda-like (default) | voiceover-like | spec-strict | all
  --budget <spec>        e.g. "announcements<8,words/min<180,no-partial"
  --json <path>          write the JSON report ("-" prints to stdout)
  --html <path>          write the HTML transcript
  --out <dir>            write report.json and report.html into <dir>
  --timeout <ms>         wait budget for the answer end mark (default 30000)
  --grace <ms>           keep recording after the end mark (default 1200)
  --wait-for <selector>  wait for this element before the end mark
  --headed               show the browser
  --quiet                suppress the console summary (exit code only)
  --strict               treat warnings as failures

Budget keys
  announcements<8   words<120   words/min<180   updates/s<20   assertive<=1
  no-partial  no-duplicate  no-silent  no-errors

The page must mark its stream, because "the answer finished" is not observable
from the DOM:

  window.__livesayProbe?.mark('start');
  window.__livesayProbe?.mark('done');      // or 'abort' / 'error'
`;

const colorEnabled = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

// `livesay rules | head` should end quietly, not crash on a closed pipe.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
});

function fail(message: string, code = 2): never {
  process.stderr.write(`livesay: ${message}\n`);
  process.exit(code);
}

function parseProfile(value: string | undefined): ProfileName | 'all' {
  if (!value) return 'nvda-like';
  if (value === 'all') return 'all';
  if (value in PROFILES) return value as ProfileName;
  fail(`unknown profile "${value}". Use one of: ${PROFILE_NAMES.join(', ')}, all.`);
}

async function writeReportFile(path: string, contents: string): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
  process.stderr.write(`wrote ${target}\n`);
}

function comparison(reports: Array<{ profile: ProfileName; report: AuditReport }>): string {
  const header = ['profile', 'announcements', 'words/min', 'updates/s', 'partial', 'dup', 'assertive', 'verdict'];
  const rows = reports.map(({ profile, report }) => [
    profile,
    String(report.metrics.utterances),
    report.metrics.wordsPerMinute === null ? '—' : String(report.metrics.wordsPerMinute),
    String(report.metrics.peakUpdatesPerSecond),
    String(report.metrics.partials),
    String(report.metrics.duplicates),
    String(report.metrics.assertive),
    report.verdict.toUpperCase(),
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd();
  return [line(header), widths.map((width) => '─'.repeat(width)).join('  '), ...rows.map(line)].join('\n');
}

async function runAudit(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      profile: { type: 'string', default: 'nvda-like' },
      budget: { type: 'string' },
      json: { type: 'string' },
      html: { type: 'string' },
      out: { type: 'string' },
      timeout: { type: 'string', default: '30000' },
      grace: { type: 'string', default: '1200' },
      'wait-for': { type: 'string' },
      headed: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const url = positionals[0];
  if (!url) fail('audit needs a URL: livesay audit http://localhost:3000');

  const profile = parseProfile(values.profile);
  const timeoutMs = Number(values.timeout);
  const graceMs = Number(values.grace);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('--timeout must be a positive number of milliseconds');
  if (!Number.isFinite(graceMs) || graceMs < 0) fail('--grace must be zero or more milliseconds');

  let captured;
  try {
    captured = await capture({
      url,
      timeoutMs,
      graceMs,
      headed: values.headed,
      ...(values['wait-for'] ? { waitFor: values['wait-for'] } : {}),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }

  if (captured.snapshot.answers.length === 0) {
    process.stderr.write(
      'livesay: no answer markers found — silence rules need window.__livesayProbe.mark("done"). Auditing the recording without them.\n',
    );
  } else if (captured.status === 'timeout') {
    process.stderr.write(
      `livesay: no answer end mark within ${timeoutMs}ms — recording what happened and reporting it.\n`,
    );
  }

  const profiles: ProfileName[] = profile === 'all' ? PROFILE_NAMES : [profile];
  const reports = profiles.map((name) => ({
    profile: name,
    report: audit(captured.snapshot, {
      profile: name,
      ...(values.budget ? { budget: values.budget } : {}),
    }),
  }));

  const primary = reports[0]?.report;
  if (!primary) fail('audit produced no report');

  const jsonStdout = values.json === '-';
  if (profile === 'all' && !values.quiet) {
    (jsonStdout ? process.stderr : process.stdout).write(`${comparison(reports)}\n\n`);
  }

  if (!values.quiet) {
    (jsonStdout ? process.stderr : process.stdout).write(`${renderConsole(primary, { color: colorEnabled() })}\n`);
  }

  const selectedReports = reports.map(entry => entry.report);
  const json = profile === 'all' ? renderReportsJson(selectedReports) : renderJson(primary);
  const html = profile === 'all' ? renderReportsHtml(selectedReports) : renderHtml(primary);

  if (values.json) {
    if (values.json === '-') process.stdout.write(json);
    else await writeReportFile(values.json, json);
  }

  if (values.html) {
    await writeReportFile(values.html, html);
  }

  if (values.out) {
    const dir = resolve(values.out);
    await writeReportFile(join(dir, 'report.json'), json);
    await writeReportFile(join(dir, 'report.html'), html);
  }

  const failed = reportsFailed(selectedReports, values.strict);

  process.exit(failed ? 1 : 0);
}

async function runServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '4319' },
      host: { type: 'string', default: '127.0.0.1' },
    },
  });
  const port = Number(values.port);
  if (!Number.isFinite(port) || port < 0) fail('--port must be a port number');

  const server = await startServer({ port, host: values.host });
  process.stdout.write(
    [
      `livesay demo listening on ${server.url}`,
      '',
      `  ${server.url}/bad.html    naive streaming (token storm, silent completion)`,
      `  ${server.url}/good.html   livesay announcer (sentence chunks, completion)`,
      '',
      `  npx livesay audit ${server.url}/bad.html --budget "announcements<8,no-silent"`,
      '',
      'Ctrl+C to stop.',
      '',
    ].join('\n'),
  );

  const stop = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

function runRules(): void {
  const rows: Array<[string, string, string]> = [
    ['token-storm', 'error', 'A live region (or ariaNotify) updated N times inside one second; every token becomes speech.'],
    ['silent-completion', 'error', 'The stream ended and nothing was announced after it — the listener is never told the answer is done.'],
    ['silent-abort', 'error', 'The stream stopped or failed and the page went quiet instead of saying so.'],
    ['assertive-abuse', 'error', 'More than one assertive announcement per answer, which interrupts whatever was being read.'],
    ['duplicate-announcement', 'warn', 'The same passage announced twice within the duplicate window.'],
    ['partial-announcement', 'warn', 'An utterance is a truncated prefix of the next, so the sentence is heard twice from the start.'],
  ];
  const width = Math.max(...rows.map(([name]) => name.length));
  for (const [name, severity, description] of rows) {
    process.stdout.write(`${name.padEnd(width)}  ${severity.padEnd(5)}  ${description}\n`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  switch (command) {
    case 'audit':
      await runAudit(rest);
      return;
    case 'serve':
    case 'demo':
      await runServe(rest);
      return;
    case 'rules':
      runRules();
      return;
    default:
      fail(`unknown command "${command}". Try "livesay help".`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof BudgetError) fail(error.message, 2);
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error), 2);
});
