// OAuth discovery checks, following Claude's documented client behaviour.
// Read-only: it fetches metadata and sends one deliberately invalid refresh request. It never registers a client.

import { request, parseJson } from '../http.js';

const LIMIT_MS = 10000;
const SLOW_MS = 5000;
const REFRESH_LIMIT_MS = 30000;

export function parseWwwAuthenticate(header) {
  if (!header) return undefined;
  const scheme = header.trim().split(/\s+/)[0];
  const params = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m;
  while ((m = re.exec(header))) params[m[1].toLowerCase()] = m[2] ?? m[3];
  return { scheme, params };
}

export function prmCandidates(serverUrl, pointer) {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/$/, '');
  const list = [];
  if (pointer) list.push({ url: pointer, via: 'WWW-Authenticate resource_metadata' });
  if (path) list.push({ url: `${u.origin}/.well-known/oauth-protected-resource${path}`, via: 'well-known probe (with path)' });
  list.push({ url: `${u.origin}/.well-known/oauth-protected-resource`, via: 'well-known probe (root)' });
  return list;
}

export function asCandidates(issuer) {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/$/, '');
  if (!path) {
    return [
      `${u.origin}/.well-known/oauth-authorization-server`,
      `${u.origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    `${u.origin}/.well-known/openid-configuration${path}`,
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

async function firstJson(urls, timeoutMs) {
  const tried = [];
  for (const entry of urls) {
    const url = typeof entry === 'string' ? entry : entry.url;
    const res = await request(url, { headers: { accept: 'application/json' }, timeoutMs, follow: true });
    tried.push({ url, status: res.status || res.error, ms: res.ms });
    const json = res.ok && res.status === 200 ? parseJson(res.text) : undefined;
    if (json && typeof json === 'object') return { json, url, ms: res.ms, via: entry.via, tried };
  }
  return { tried };
}

export async function checkAuth({ serverUrl, initRes, timeoutMs = 15000, probeToken = true }) {
  const findings = [];
  const add = (rule, status, detail) => findings.push({ rule, status, detail });
  const timings = [];

  const header = initRes.headers.get('www-authenticate');
  const challenge = parseWwwAuthenticate(header);
  const pointer = challenge?.params?.resource_metadata;

  if (initRes.status === 401) {
    add('auth.401-required', 'pass', 'Unauthenticated initialize returned 401.');
    if (pointer) add('auth.resource-metadata-pointer', 'pass', `resource_metadata="${pointer}"`);
    else add('auth.resource-metadata-pointer', 'fail', header ? `WWW-Authenticate is "${header}" with no resource_metadata.` : 'The 401 has no WWW-Authenticate header.');
  } else if (header) {
    add('auth.401-required', 'fail', `HTTP ${initRes.status} carried WWW-Authenticate. Claude only starts sign-in from a 401.`);
  }

  // Look for OAuth metadata even when initialize succeeded anonymously: lazy-auth servers still need it.
  const prm = await firstJson(prmCandidates(serverUrl, pointer), timeoutMs);
  if (!prm.json) {
    if (initRes.status === 401) {
      add('auth.prm-found', 'fail', `Tried ${prm.tried.map((t) => `${t.url} (${t.status})`).join(', ')}.`);
    }
    return { findings, oauth: false };
  }
  timings.push({ what: 'protected resource metadata', ms: prm.ms });
  add('auth.prm-found', 'pass', `${prm.url} (via ${prm.via})`);

  const resource = prm.json.resource;
  if (resource === serverUrl) add('auth.resource-matches', 'pass', resource);
  else {
    const hint = resource && resource.replace(/\/$/, '') === serverUrl.replace(/\/$/, '') ? ' The only difference is a trailing slash, and that still fails.' : '';
    add('auth.resource-matches', 'fail', `"resource" is ${JSON.stringify(resource)} but the server URL is "${serverUrl}".${hint}`);
  }

  const servers = Array.isArray(prm.json.authorization_servers) ? prm.json.authorization_servers : [];
  if (!servers.length) {
    add('auth.authorization-servers', 'fail', 'authorization_servers is missing or empty.');
    return { findings, oauth: true };
  }
  let candidates;
  try {
    if (typeof servers[0] !== 'string') throw new Error('not a string');
    candidates = asCandidates(servers[0]);
  } catch {
    add('auth.authorization-servers', 'fail', `The first entry, ${JSON.stringify(servers[0])}, is not a full issuer URL such as "https://auth.example.com".`);
    return { findings, oauth: true };
  }
  add('auth.authorization-servers', 'pass', servers.length > 1 ? `${servers[0]} (Claude ignores the other ${servers.length - 1})` : servers[0]);

  const as = await firstJson(candidates, timeoutMs);
  if (!as.json) {
    add('auth.as-metadata', 'fail', `Tried ${as.tried.map((t) => `${t.url} (${t.status})`).join(', ')}.`);
    return { findings, oauth: true };
  }
  timings.push({ what: 'authorization server metadata', ms: as.ms });
  add('auth.as-metadata', 'pass', as.url);
  const meta = as.json;

  const pkce = meta.code_challenge_methods_supported;
  if (Array.isArray(pkce) && pkce.includes('S256')) add('auth.pkce-s256', 'pass', 'code_challenge_methods_supported includes S256.');
  else add('auth.pkce-s256', 'fail', pkce ? `code_challenge_methods_supported is ${JSON.stringify(pkce)}.` : 'code_challenge_methods_supported is not advertised.');

  const hasDcr = typeof meta.registration_endpoint === 'string';
  const authMethods = Array.isArray(meta.token_endpoint_auth_methods_supported) ? meta.token_endpoint_auth_methods_supported : [];
  const hasCimd = meta.client_id_metadata_document_supported === true && authMethods.includes('none');
  if (hasCimd) add('auth.client-registration', 'pass', `Client ID Metadata Document${hasDcr ? ' (and DCR)' : ''}.`);
  else if (hasDcr) {
    add('auth.client-registration', 'pass', 'Dynamic Client Registration.');
    add('auth.dcr-at-scale', 'fail', 'Only DCR is available.');
  } else {
    const cimdHalf = meta.client_id_metadata_document_supported === true ? ' client_id_metadata_document_supported is true but "none" is missing from token_endpoint_auth_methods_supported, so Claude will not use CIMD.' : '';
    add('auth.client-registration', 'fail', `No registration_endpoint and no usable CIMD.${cimdHalf}`);
  }

  const scopes = meta.scopes_supported;
  if (Array.isArray(scopes)) {
    add('auth.offline-access', scopes.includes('offline_access') ? 'pass' : 'fail', scopes.includes('offline_access') ? 'Advertised.' : 'Not in scopes_supported.');
  }

  if (probeToken && typeof meta.token_endpoint === 'string') {
    const res = await request(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'connector-preflight-deliberately-invalid',
        client_id: 'connector-preflight-probe',
      }).toString(),
      timeoutMs: Math.max(timeoutMs, REFRESH_LIMIT_MS + 1000),
    });
    // Refresh requests get 30 seconds from Claude, not 10.
    if (res.ok) timings.push({ what: 'token endpoint (refresh)', ms: res.ms, limit: REFRESH_LIMIT_MS });
    if (res.timedOut) {
      timings.push({ what: 'token endpoint (refresh)', ms: res.ms, limit: REFRESH_LIMIT_MS, timedOut: true });
      add('auth.token-form-encoded', 'skip', 'The token endpoint did not answer, so its content type could not be checked.');
    } else if (!res.ok) {
      add('auth.token-form-encoded', 'skip', `Token endpoint did not answer: ${res.error}.`);
    } else if (res.status === 415) {
      add('auth.token-form-encoded', 'fail', `${meta.token_endpoint} returned 415 Unsupported Media Type.`);
    } else {
      add('auth.token-form-encoded', 'pass', `HTTP ${res.status} to a form-encoded refresh request.`);
      const code = parseJson(res.text)?.error;
      if (code === 'invalid_grant') add('auth.invalid-grant', 'pass', 'An invalid refresh token got invalid_grant.');
      else if (['invalid_client', 'unauthorized_client', 'invalid_request'].includes(code)) add('auth.invalid-grant', 'skip', `The server rejected the probe's made-up client first (${code}), so the refresh-token error could not be seen. Check it with a real client ID.`);
      else add('auth.invalid-grant', 'fail', code ? `An invalid refresh token got "${code}".` : `HTTP ${res.status} with no OAuth error code in the body.`);
    }
  }

  const over = timings.filter((t) => t.timedOut || t.ms > (t.limit || LIMIT_MS));
  const slow = timings.filter((t) => !over.includes(t) && t.ms > SLOW_MS);
  if (over.length) add('auth.latency', 'fail', over.map((t) => `${t.what} ${t.timedOut ? 'did not answer within' : 'took'} ${(t.ms / 1000).toFixed(1)}s (limit ${(t.limit || LIMIT_MS) / 1000}s)`).join('; '));
  else add('auth.latency', 'pass', slow.length
    ? `Inside the limits, but slow: ${slow.map((t) => `${t.what} ${(t.ms / 1000).toFixed(1)}s`).join('; ')}`
    : `Slowest: ${Math.max(...timings.map((t) => t.ms))} ms`);

  return { findings, oauth: true };
}
