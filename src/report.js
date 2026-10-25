import { RULES, SOURCES } from './rules.js';

const GROUPS = [
  ['transport', 'Transport'],
  ['auth', 'Authentication'],
  ['tools', 'Tools'],
  ['apps', 'MCP App'],
  ['listing', 'Listing'],
];

const MAX_ITEMS = 8;

// Server-supplied text (tool names, descriptions, server info) is untrusted: drop control characters so it
// cannot move the terminal cursor or colour, and in markdown keep it on one line inside the table.
const clean = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
const cleanMd = (v) => clean(v).replace(/[\r\n\t]+/g, ' ').replace(/[|`<>]/g, (c) => ({ '|': '\\|', '`': "'", '<': '&lt;', '>': '&gt;' }[c]));

function mark(f, color) {
  const c = color ? (code, s) => `\x1b[${code}m${s}\x1b[0m` : (_c, s) => s;
  if (f.status === 'pass') return c(32, '✔');
  if (f.status === 'skip') return c(90, '–');
  if (f.level === 'error') return c(31, '✖');
  if (f.level === 'warn') return c(33, '!');
  return c(36, 'i');
}

function verdict(report) {
  const { blocking, warnings, notes } = report.counts;
  if (report.couldNotRun) return 'Could not run: the server was not reachable as an MCP endpoint.';
  if (report.toolsSkipped && !blocking) return 'Not finished: tools were not checked.';
  if (!blocking) return `Ready to submit on everything a script can check (${warnings} warning${warnings === 1 ? '' : 's'}, ${notes} note${notes === 1 ? '' : 's'}).`;
  return `${blocking} blocking issue${blocking === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${notes} note${notes === 1 ? '' : 's'}.`;
}

export function renderText(report, { color = false, verbose = false } = {}) {
  const dim = (s) => (color ? `\x1b[90m${s}\x1b[0m` : s);
  const bold = (s) => (color ? `\x1b[1m${s}\x1b[0m` : s);
  const out = [];
  out.push(bold(`connector-preflight ${report.version}`) + dim(`  ·  rules checked against Claude's docs on ${report.rulesChecked}`));
  out.push(clean(report.url));
  if (report.serverInfo) out.push(dim(clean(`${report.serverInfo.name || '?'} ${report.serverInfo.version || ''}`.trim())));
  out.push('');

  for (const [prefix, label] of GROUPS) {
    const fs = report.findings.filter((f) => f.rule.startsWith(`${prefix}.`));
    if (!fs.length && !(prefix === 'tools' && report.toolsSkipped)) continue;
    out.push(bold(label));
    for (const f of fs) {
      const rule = RULES[f.rule];
      if (f.status === 'pass' && !verbose) {
        out.push(`  ${mark(f, color)} ${rule.title}`);
        continue;
      }
      out.push(`  ${mark(f, color)} ${rule.title}`);
      if (f.detail) out.push(`      ${clean(f.detail)}`);
      if (f.items?.length && f.status !== 'pass') {
        for (const item of f.items.slice(0, MAX_ITEMS)) out.push(`        · ${clean(item)}`);
        if (f.items.length > MAX_ITEMS) out.push(`        · and ${f.items.length - MAX_ITEMS} more (use --json for all)`);
      }
      if (f.status === 'fail') {
        out.push(dim(`      fix: ${rule.fix}`));
        out.push(dim(`      source: ${SOURCES[rule.source].url}`));
      }
    }
    if (prefix === 'tools' && report.toolsSkipped) out.push(`  ${color ? '\x1b[90m–\x1b[0m' : '–'} ${clean(report.toolsSkipped)}`);
    out.push('');
  }

  out.push(bold('Check by hand before you submit'));
  for (const m of report.manual) out.push(`  ☐ ${m.text}`);
  out.push('');
  out.push(bold(verdict(report)));
  return out.join('\n');
}

export function renderMarkdown(report) {
  const icon = (f) => (f.status === 'pass' ? '✅' : f.status === 'skip' ? '➖' : f.level === 'error' ? '❌' : f.level === 'warn' ? '⚠️' : 'ℹ️');
  const out = [];
  out.push(`## Connector preflight: ${report.ready ? 'ready' : report.counts.blocking ? 'not ready' : 'incomplete'}`);
  out.push('');
  out.push(`${cleanMd(report.url)} · ${verdict(report)} · rules checked ${report.rulesChecked}`);
  out.push('');
  out.push('| | Check | Detail |');
  out.push('| - | - | - |');
  for (const f of report.findings) {
    const rule = RULES[f.rule];
    let detail = cleanMd(f.detail);
    if (f.status === 'fail') {
      if (f.items?.length) detail += `<br>${f.items.slice(0, MAX_ITEMS).map((i) => `\`${cleanMd(i)}\``).join(', ')}${f.items.length > MAX_ITEMS ? ` and ${f.items.length - MAX_ITEMS} more` : ''}`;
      detail += `<br>**Fix:** ${rule.fix} ([source](${SOURCES[rule.source].url}))`;
    }
    out.push(`| ${icon(f)} | ${rule.title} | ${detail} |`);
  }
  if (report.toolsSkipped) out.push(`| ➖ | Tools | ${cleanMd(report.toolsSkipped)} |`);
  out.push('');
  out.push('<details><summary>Check by hand before you submit</summary>');
  out.push('');
  for (const m of report.manual) out.push(`- [ ] ${m.text}`);
  out.push('');
  out.push('</details>');
  out.push('');
  out.push('_Made by [connector-preflight](https://github.com/PressoNetwork/connector-preflight). Read-only: it never calls your tools._');
  return out.join('\n');
}
