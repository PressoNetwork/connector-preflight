// A minimal, read-only MCP client for the Streamable HTTP transport.
// It initialises and lists. It never calls a tool, reads a resource or gets a prompt.

import { request, parseJson } from './http.js';
import { VERSION } from './version.js';

export const PROTOCOL_VERSION = '2025-11-25';

export class McpClient {
  constructor(url, { token, timeoutMs = 15000 } = {}) {
    this.url = url;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.sessionId = undefined;
    this.protocolVersion = PROTOCOL_VERSION;
    this.capabilities = {};
    this.nextId = 1;
  }

  headers() {
    const h = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    if (this.initialised) h['mcp-protocol-version'] = this.protocolVersion;
    return h;
  }

  async send(method, params, { notification = false } = {}) {
    const message = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    const id = notification ? undefined : this.nextId++;
    if (id !== undefined) message.id = id;

    const res = await request(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(message),
      timeoutMs: this.timeoutMs,
      // Stop reading an SSE stream as soon as the reply to this request has arrived.
      untilMatch: id === undefined ? undefined : (text) => readSse(text, id) !== undefined,
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    let reply;
    if (res.ok && res.status >= 200 && res.status < 300 && !notification) {
      const type = (res.headers.get('content-type') || '').toLowerCase();
      reply = type.includes('text/event-stream') ? readSse(res.text, id) : parseJson(res.text);
    }
    return { ...res, reply };
  }

  async initialize() {
    const res = await this.send('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'connector-preflight', version: VERSION },
    });
    const result = res.reply?.result;
    if (result && typeof result === 'object') {
      this.protocolVersion = result.protocolVersion || PROTOCOL_VERSION;
      this.serverInfo = result.serverInfo;
      this.capabilities = result.capabilities && typeof result.capabilities === 'object' ? result.capabilities : {};
      this.initialised = true;
      await this.send('notifications/initialized', undefined, { notification: true });
    }
    return res;
  }

  // Ends the session politely. Servers that do not support it answer 405, which is fine.
  async close() {
    if (!this.sessionId) return;
    await request(this.url, { method: 'DELETE', headers: this.headers(), timeoutMs: 5000 });
  }

  // Follows nextCursor until the list ends, with a hard page cap so a looping cursor cannot hang the run.
  async listAll(method, key, maxPages = 50) {
    const items = [];
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.send(method, cursor ? { cursor } : {});
      const result = res.reply?.result;
      if (!result || typeof result !== 'object') return { items, error: describeFailure(res) };
      const pageItems = result[key];
      if (pageItems !== undefined && !Array.isArray(pageItems)) return { items, error: `"${key}" in the ${method} result is not an array` };
      items.push(...(pageItems || []));
      cursor = result.nextCursor;
      if (!cursor) return { items };
    }
    return { items, error: `stopped after ${maxPages} pages` };
  }
}

export function readSse(text, id) {
  // SSE events are separated by a blank line; each data: line carries part of one JSON-RPC message.
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const msg = parseJson(data);
    if (msg && (id === undefined || msg.id === id)) return msg;
  }
  return undefined;
}

export function describeFailure(res) {
  if (!res.ok) return res.error;
  if (res.reply?.error) return `JSON-RPC error ${res.reply.error.code}: ${res.reply.error.message}`;
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location');
    return `HTTP ${res.status} redirect${to ? ` to ${to}` : ''}. Point the listing at the final URL`;
  }
  if (res.status >= 400) return `HTTP ${res.status}`;
  return 'no JSON-RPC result in the response';
}
