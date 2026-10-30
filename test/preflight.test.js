import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../src/preflight.js';
import { parseWwwAuthenticate, asCandidates, prmCandidates } from '../src/checks/auth.js';
import { readSse } from '../src/mcp-client.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { renderText, renderMarkdown } from '../src/report.js';
import { startServer, goodTools } from './fixture-server.js';

const status = (report, rule) => report.findings.filter((f) => f.rule === rule).map((f) => f.status);

test('parses WWW-Authenticate parameters', () => {
  const p = parseWwwAuthenticate('Bearer resource_metadata="https://x/.well-known/oauth-protected-resource", scope="read write"');
  assert.equal(p.scheme, 'Bearer');
  assert.equal(p.params.resource_metadata, 'https://x/.well-known/oauth-protected-resource');
  assert.equal(p.params.scope, 'read write');
});

test('builds discovery URLs the way the MCP spec orders them', () => {
  assert.deepEqual(asCandidates('https://a.com'), ['https://a.com/.well-known/oauth-authorization-server', 'https://a.com/.well-known/openid-configuration']);
  assert.deepEqual(asCandidates('https://a.com/tenant1'), [
    'https://a.com/.well-known/oauth-authorization-server/tenant1',
    'https://a.com/.well-known/openid-configuration/tenant1',
    'https://a.com/tenant1/.well-known/openid-configuration',
  ]);
  assert.deepEqual(prmCandidates('https://a.com/mcp').map((c) => c.url), ['https://a.com/.well-known/oauth-protected-resource/mcp', 'https://a.com/.well-known/oauth-protected-resource']);
});

test('reads the matching message out of an SSE stream', () => {
  const text = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assert.deepEqual(readSse(text, 7), { jsonrpc: '2.0', id: 7, result: { ok: true } });
});

test('an open server with good tools is ready, apart from HTTPS on localhost', async () => {
  const s = await startServer({ tools: goodTools });
  try {
    const r = await preflight(s.url);
    assert.deepEqual(status(r, 'transport.https'), ['fail']);
    assert.equal(r.counts.blocking, 1);
    assert.equal(r.tools.length, 3, 'paginated tools/list is followed to the end');
    assert.equal(r.auth, 'none');
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('SSE responses and session ids are handled', async () => {
  const s = await startServer({ sse: true });
  try {
    const r = await preflight(s.url);
    assert.equal(r.tools.length, 3);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('a well-configured OAuth server passes discovery and needs a token for tools', async () => {
  const s = await startServer({ auth: 'oauth' });
  try {
    const r = await preflight(s.url);
    for (const rule of ['auth.401-required', 'auth.resource-metadata-pointer', 'auth.prm-found', 'auth.resource-matches', 'auth.authorization-servers', 'auth.as-metadata', 'auth.pkce-s256', 'auth.client-registration', 'auth.token-form-encoded', 'auth.invalid-grant', 'auth.latency']) {
      assert.deepEqual(status(r, rule), ['pass'], rule);
    }
    assert.match(r.toolsSkipped, /--token/);
    assert.equal(r.ready, false);

    const signedIn = await preflight(s.url, { token: 'good-token' });
    assert.equal(signedIn.tools.length, 3);
    assert.equal(signedIn.signedIn, true);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('broken OAuth discovery is reported rule by rule', async () => {
  const s = await startServer({ auth: 'oauth', pointer: false, resourceSuffix: '/', pkce: null, registration: false, tokenStatus: 415 });
  try {
    const r = await preflight(s.url);
    assert.deepEqual(status(r, 'auth.resource-metadata-pointer'), ['fail']);
    assert.deepEqual(status(r, 'auth.prm-found'), ['pass'], 'falls back to the well-known probe');
    assert.deepEqual(status(r, 'auth.resource-matches'), ['fail']);
    assert.match(r.findings.find((f) => f.rule === 'auth.resource-matches').detail, /trailing slash/);
    assert.deepEqual(status(r, 'auth.pkce-s256'), ['fail']);
    assert.deepEqual(status(r, 'auth.client-registration'), ['fail']);
    assert.deepEqual(status(r, 'auth.token-form-encoded'), ['fail']);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('CIMD counts as registration only with "none" in token_endpoint_auth_methods_supported', async () => {
  const s = await startServer({ auth: 'oauth', registration: false, cimd: true });
  try {
    const r = await preflight(s.url);
    assert.deepEqual(status(r, 'auth.client-registration'), ['pass']);
    assert.deepEqual(status(r, 'auth.dcr-at-scale'), []);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('a non-standard refresh-token error code is a warning, invalid_request is inconclusive', async () => {
  const s = await startServer({ auth: 'oauth', tokenError: 'token_expired' });
  try {
    const r = await preflight(s.url);
    assert.deepEqual(status(r, 'auth.invalid-grant'), ['fail']);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('an MCP App is detected end to end', async () => {
  const s = await startServer({ uiResource: true });
  try {
    const r = await preflight(s.url);
    assert.deepEqual(status(r, 'apps.screenshots'), ['fail']);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('an unreachable server fails cleanly', async () => {
  const r = await preflight('https://127.0.0.1:1/mcp', { timeoutMs: 2000 });
  assert.deepEqual(status(r, 'transport.reachable'), ['fail']);
});

test('reports render as text and markdown', async () => {
  const s = await startServer({ tools: [{ name: 'x', description: 'short' }] });
  try {
    const r = await preflight(s.url);
    const text = renderText(r);
    assert.match(text, /Every tool has a title/);
    assert.match(text, /source: https:\/\/claude\.com\/docs/);
    const md = renderMarkdown(r);
    assert.match(md, /\| ❌ \| Every tool has a title/);
    assert.deepEqual(s.violations, [], 'never calls tools, reads resources or registers clients');
  } finally { await s.close(); }
});

test('a malformed tools/list result is reported, not a crash', async () => {
  const s = await startServer({ toolsRaw: { not: 'an array' } });
  try {
    const r = await preflight(s.url);
    assert.match(r.toolsSkipped, /not an array/);
    assert.equal(r.finished, false);
  } finally { await s.close(); }
});

test('an authorization server that is not a URL fails its rule instead of crashing', async () => {
  const s = await startServer({ auth: 'oauth', authServers: ['auth.example.com'] });
  try {
    const r = await preflight(s.url);
    assert.deepEqual(status(r, 'auth.authorization-servers'), ['fail']);
  } finally { await s.close(); }
});

test('an SSE stream the server keeps open does not hang the run', async () => {
  const s = await startServer({ sseKeepOpen: true });
  try {
    const started = Date.now();
    const r = await preflight(s.url, { timeoutMs: 4000 });
    assert.equal(r.tools.length, 3);
    assert.ok(Date.now() - started < 3000, 'finished without waiting for timeouts');
  } finally { await s.close(); }
});

test('a redirect on the MCP endpoint is named as one', async () => {
  const s = await startServer({ redirect: true });
  try {
    const r = await preflight(s.url);
    assert.match(r.findings.find((f) => f.rule === 'transport.reachable').detail, /307 redirect/);
    assert.equal(r.couldNotRun, true);
  } finally { await s.close(); }
});

test('a refused token gets its own finding', async () => {
  const s = await startServer({ auth: 'oauth' });
  try {
    const r = await preflight(s.url, { token: 'wrong-token' });
    assert.deepEqual(status(r, 'auth.token-accepted'), ['fail']);
    assert.deepEqual(status(r, 'transport.reachable'), ['pass']);
    assert.match(r.toolsSkipped, /refused/);
  } finally { await s.close(); }
});

test('a token is never sent to a non-HTTPS remote host', async () => {
  const r = await preflight('http://example.invalid/mcp', { token: 'secret', timeoutMs: 2000 });
  assert.deepEqual(status(r, 'auth.token-accepted'), ['skip']);
});

test('listing URLs are checked even when the tools need sign-in', async () => {
  const s = await startServer({ auth: 'oauth' });
  try {
    const r = await preflight(s.url, { privacyUrl: 'http://example.com/privacy' });
    assert.deepEqual(status(r, 'listing.privacy-url'), ['fail']);
  } finally { await s.close(); }
});

test('exit codes: 2 for an invalid URL or no server, 1 for blocking issues', async () => {
  const bin = new URL('../bin/connector-preflight.js', import.meta.url).pathname;
  const code = (args) => run(process.execPath, [bin, ...args]).then(() => 0, (e) => e.code);
  assert.equal(await code(['not a url']), 2);
  assert.equal(await code(['https://127.0.0.1:1/mcp', '--timeout', '2']), 2);
  const s = await startServer({});
  try {
    assert.equal(await code([s.url]), 1, 'plain http is blocking');
    assert.equal(await code([s.url, '--no-fail']), 0);
    const { stdout } = await run(process.execPath, [bin, s.url, '--format', 'json', '--no-fail']);
    assert.equal(JSON.parse(stdout).tools.length, 3, 'piped JSON is complete');
    const short = await run(process.execPath, [bin, s.url, '--json', '--no-fail']);
    assert.equal(JSON.parse(short.stdout).tools.length, 3, '--json is the same as --format json');
  } finally { await s.close(); }
});
