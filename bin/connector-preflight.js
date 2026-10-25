#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { appendFileSync } from 'node:fs';
import { preflight } from '../src/preflight.js';
import { renderText, renderMarkdown } from '../src/report.js';
import { VERSION } from '../src/version.js';

const HELP = `connector-preflight ${VERSION}
Check a remote MCP server against the Claude connectors directory requirements before you submit.

Usage
  npx -y github:PressoNetwork/connector-preflight <server-url> [options]

Options
  --token <token>       Access token, to check tools on a server that needs sign-in
                        (or set MCP_PREFLIGHT_TOKEN)
  --privacy-url <url>   Privacy policy URL for the listing
  --docs-url <url>      Documentation URL for the listing
  --format <fmt>        text (default), json or markdown
  --verbose             Show detail for passing checks too
  --no-token-probe      Skip the invalid refresh-token request to your token endpoint
  --no-fail             Exit 0 even with blocking issues or unchecked tools
  --markdown-out <file> Also append a markdown report to a file (for CI job summaries)
  --timeout <seconds>   Per-request timeout (default 15)
  -h, --help            Show this help
  -v, --version         Show the version

Read-only: it initialises and lists. It never calls a tool, reads a resource or registers an OAuth client.
Exit codes: 0 ready, 1 blocking issues, 2 could not run, 3 not finished (tools not checked).`;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      token: { type: 'string' },
      'privacy-url': { type: 'string' },
      'docs-url': { type: 'string' },
      format: { type: 'string', default: 'text' },
      verbose: { type: 'boolean', default: false },
      'no-token-probe': { type: 'boolean', default: false },
      'no-fail': { type: 'boolean', default: false },
      'markdown-out': { type: 'string' },
      timeout: { type: 'string', default: '15' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (err) {
  console.error(`${err.message}\n\n${HELP}`);
  process.exit(2);
}

const { values, positionals } = args;
if (values.help) { console.log(HELP); process.exit(0); }
if (values.version) { console.log(VERSION); process.exit(0); }
if (positionals.length !== 1) { console.error(HELP); process.exit(2); }
if (!['text', 'json', 'markdown'].includes(values.format)) { console.error(`Unknown format "${values.format}".`); process.exit(2); }

const report = await preflight(positionals[0], {
  token: values.token || process.env.MCP_PREFLIGHT_TOKEN || undefined,
  privacyUrl: values['privacy-url'],
  docsUrl: values['docs-url'],
  timeoutMs: Math.max(1, Number(values.timeout) || 15) * 1000,
  probeToken: !values['no-token-probe'],
});

if (values['markdown-out']) appendFileSync(values['markdown-out'], `${renderMarkdown(report)}\n`);
if (values.format === 'json') console.log(JSON.stringify(report, null, 2));
else if (values.format === 'markdown') console.log(renderMarkdown(report));
else console.log(renderText(report, { color: process.stdout.isTTY && !process.env.NO_COLOR, verbose: values.verbose }));

// exitCode rather than exit(), so piped output is fully written before the process ends.
if (report.couldNotRun) process.exitCode = 2;
else if (report.counts.blocking && !values['no-fail']) process.exitCode = 1;
else if (!report.finished && !values['no-fail']) process.exitCode = 3;
else process.exitCode = 0;
