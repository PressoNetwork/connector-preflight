import { McpClient, describeFailure } from './mcp-client.js';
import { checkAuth } from './checks/auth.js';
import { checkTools, detectMcpApp } from './checks/tools.js';
import { checkListingUrl } from './checks/listing.js';
import { RULES, MANUAL_CHECKS, RULES_CHECKED } from './rules.js';
import { VERSION } from './version.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export async function preflight(url, { token, privacyUrl, docsUrl, timeoutMs = 15000, probeToken = true } = {}) {
  const findings = [];
  const add = (rule, status, detail, items) => findings.push({ rule, status, detail, items });
  const report = { tool: 'connector-preflight', version: VERSION, rulesChecked: RULES_CHECKED, url, findings, manual: MANUAL_CHECKS };

  let parsed;
  try { parsed = new URL(url); } catch { parsed = undefined; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    add('transport.https', 'fail', `"${url}" is not a valid http(s) URL.`);
    report.couldNotRun = true;
    return finish(report);
  }
  const https = parsed.protocol === 'https:';
  add('transport.https', https ? 'pass' : 'fail', https ? 'https://' : 'The URL uses http://.');

  // Listing URLs do not depend on the server, so check them first: a sign-in server still gets them.
  for (const [rule, u] of [['listing.privacy-url', privacyUrl], ['listing.docs-url', docsUrl]]) {
    const f = await checkListingUrl(rule, u, timeoutMs);
    if (f) findings.push(f);
  }

  // Never send a bearer token in the clear, except to a server on this machine.
  if (token && !https && !LOCAL_HOSTS.has(parsed.hostname)) {
    add('auth.token-accepted', 'skip', 'Not sent: the URL is not HTTPS, and a token is never sent in the clear.');
    token = undefined;
  }

  // 1. Anonymous initialize: what a fresh connection from Claude sees first.
  const anon = new McpClient(url, { timeoutMs });
  const anonInit = await anon.initialize();
  if (!anonInit.ok) {
    add('transport.reachable', 'fail', anonInit.error);
    report.couldNotRun = true;
    return finish(report);
  }
  const anonOk = Boolean(anonInit.reply?.result);
  if (anonOk || anonInit.status === 401) {
    add('transport.reachable', 'pass', anonOk ? `Initialised anonymously in ${anonInit.ms} ms (protocol ${anon.protocolVersion}).` : `401 in ${anonInit.ms} ms, which starts sign-in.`);
  } else {
    add('transport.reachable', 'fail', `${describeFailure(anonInit)} (${anonInit.ms} ms).`);
    report.couldNotRun = true;
    return finish(report);
  }

  // 2. OAuth discovery.
  const auth = await checkAuth({ serverUrl: url, initRes: anonInit, timeoutMs, probeToken });
  findings.push(...auth.findings);
  report.auth = auth.oauth ? 'oauth' : anonOk ? 'none' : 'unknown';

  // 3. Tools: with the token when one is given, otherwise anonymously if the server allows it.
  let client = anonOk ? anon : undefined;
  let signedInClient;
  if (token) {
    signedInClient = new McpClient(url, { token, timeoutMs });
    const init = await signedInClient.initialize();
    if (init.reply?.result) {
      add('auth.token-accepted', 'pass', 'Initialised with the token.');
      client = signedInClient;
      report.signedIn = true;
    } else {
      add('auth.token-accepted', 'fail', describeFailure(init));
    }
  }

  try {
    if (!client) {
      report.toolsSkipped = token
        ? 'The server needs sign-in and the token was refused, so the tools were not checked.'
        : 'The server needs sign-in. Re-run with --token (or MCP_PREFLIGHT_TOKEN) to check the tools.';
      return finish(report);
    }

    report.serverInfo = client.serverInfo;
    const tools = await client.listAll('tools/list', 'tools');
    if (tools.error && !tools.items.length) {
      report.toolsSkipped = `tools/list failed: ${tools.error}.${token ? '' : ' If tools need sign-in, re-run with --token.'}`;
      return finish(report);
    }

    findings.push(...checkTools(tools.items));
    report.tools = tools.items
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        name: String(t.name ?? ''),
        title: t.title || t.annotations?.title,
        readOnly: t.annotations?.readOnlyHint,
        destructive: t.annotations?.destructiveHint,
      }));

    // Only ask for resources when the server says it has them.
    const resources = client.capabilities.resources ? (await client.listAll('resources/list', 'resources')).items : [];
    const app = detectMcpApp(tools.items, resources);
    if (app.isApp) add('apps.screenshots', 'fail', 'This server exposes UI resources, so the listing needs carousel screenshots.', [...app.uiTools, ...app.uiResources]);
    return finish(report);
  } finally {
    await Promise.all([anon.close(), signedInClient?.close()].filter(Boolean)).catch(() => {});
  }
}

function finish(report) {
  const counts = { blocking: 0, warnings: 0, notes: 0, passed: 0, skipped: 0 };
  for (const f of report.findings) {
    const level = RULES[f.rule]?.level || 'info';
    f.level = level;
    if (f.status === 'pass') counts.passed++;
    else if (f.status === 'skip') counts.skipped++;
    else if (level === 'error') counts.blocking++;
    else if (level === 'warn') counts.warnings++;
    else counts.notes++;
  }
  report.counts = counts;
  report.finished = !report.couldNotRun && !report.toolsSkipped;
  report.ready = counts.blocking === 0 && report.finished;
  return report;
}
