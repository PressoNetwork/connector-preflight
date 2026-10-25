// A configurable fake MCP server and authorization server for tests.
import http from 'node:http';

export const goodTools = [
  {
    name: 'list_invoices',
    title: 'List invoices',
    description: 'List invoices for the signed-in account, newest first. Use when the user asks what they have billed or what is overdue.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'paid', 'overdue'], description: 'Filter by invoice status.' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_invoice',
    title: 'Create invoice',
    description: 'Create a draft invoice for a customer. Use when the user asks to bill someone. The draft is not sent.',
    inputSchema: { type: 'object', properties: { customer: { type: 'string', description: 'Customer name, for example "Acme Ltd".' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'void_invoice',
    title: 'Void invoice',
    description: 'Void an issued invoice so it can no longer be paid. Use only when the user explicitly asks to cancel an invoice.',
    inputSchema: { type: 'object', properties: { invoice_id: { type: 'string', description: 'Invoice number, for example "INV-0042".' } } },
    annotations: { destructiveHint: true },
  },
];

export function startServer(mode = {}) {
  const {
    auth = 'none', // none | oauth
    pointer = true,
    resourceSuffix = '',
    pkce = ['S256'],
    registration = true,
    cimd = false,
    tokenStatus = 400,
    tokenError = 'invalid_grant',
    sse = false,
    tools = goodTools,
    pageSize = 2,
    uiResource = false,
    sseKeepOpen = false,
    toolsRaw,
    authServers,
    redirect = false,
  } = mode;

  let base;
  // Anything preflight must never do is recorded here, and every test asserts it stays empty.
  const violations = [];
  const openStreams = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    let body = '';
    for await (const chunk of req) body += chunk;

    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      if (auth !== 'oauth') return json(404, {});
      return json(200, { resource: `${base}/mcp${resourceSuffix}`, authorization_servers: authServers ?? [`${base}/auth`] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server/auth') {
      const meta = {
        issuer: `${base}/auth`,
        authorization_endpoint: `${base}/auth/authorize`,
        token_endpoint: `${base}/auth/token`,
        scopes_supported: ['read', 'offline_access'],
        token_endpoint_auth_methods_supported: cimd ? ['none'] : ['client_secret_post'],
      };
      if (pkce) meta.code_challenge_methods_supported = pkce;
      if (registration) meta.registration_endpoint = `${base}/auth/register`;
      if (cimd) meta.client_id_metadata_document_supported = true;
      return json(200, meta);
    }
    if (url.pathname === '/auth/token') {
      if (tokenStatus === 415) return json(415, { error: 'unsupported media type' });
      return json(tokenStatus, { error: tokenError });
    }
    if (url.pathname === '/auth/register') {
      violations.push('registered a client');
      return json(201, {});
    }
    if (url.pathname === '/mcp') {
      if (redirect) { res.writeHead(307, { location: `${base}/mcp2` }); return res.end(); }
      if (req.method !== 'POST') return json(405, {});
      if (auth === 'oauth' && req.headers.authorization !== 'Bearer good-token') {
        const headers = pointer ? { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` } : {};
        return json(401, { error: 'unauthorized' }, headers);
      }
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202); return res.end(); }
      let result;
      if (msg.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: uiResource ? { tools: {}, resources: {} } : { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } };
      else if (msg.method === 'tools/list') {
        if (toolsRaw !== undefined) return json(200, { jsonrpc: '2.0', id: msg.id, result: { tools: toolsRaw } });
        const start = Number(msg.params?.cursor || 0);
        const page = tools.slice(start, start + pageSize);
        result = { tools: page };
        if (start + pageSize < tools.length) result.nextCursor = String(start + pageSize);
      } else if (msg.method === 'resources/list') {
        if (!uiResource) violations.push('listed resources without the capability');
        result = { resources: uiResource ? [{ uri: 'ui://fixture/view.html', name: 'view' }] : [] };
      } else if (['tools/call', 'resources/read', 'prompts/get'].includes(msg.method)) {
        violations.push(`called ${msg.method}`);
        return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no' } });
      } else {
        return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
      }
      const reply = { jsonrpc: '2.0', id: msg.id, result };
      if (sse || sseKeepOpen) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' });
        res.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
        if (sseKeepOpen) { openStreams.add(res); return; }
        return res.end();
      }
      return json(200, reply, { 'mcp-session-id': 'sess-1' });
    }
    json(404, {});
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url: `${base}/mcp`,
        base,
        violations,
        close: () => {
          for (const r of openStreams) r.end();
          server.closeAllConnections?.();
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}
