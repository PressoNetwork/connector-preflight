// Small fetch wrapper: timeout, timing, a response-size cap, and the user agent every request carries.

import { VERSION } from './version.js';

export const USER_AGENT = `connector-preflight/${VERSION} (+https://github.com/PressoNetwork/connector-preflight)`;
const MAX_BYTES = 5 * 1024 * 1024;

// untilMatch(text) -> boolean lets a caller stop reading a stream that the server keeps open (SSE).
export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15000, follow = false, untilMatch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': USER_AGENT, ...headers },
      body,
      redirect: follow ? 'follow' : 'manual',
      signal: controller.signal,
    });
    const text = await readBody(res, untilMatch);
    return { ok: true, status: res.status, headers: res.headers, text, ms: Math.round(performance.now() - started) };
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      text: '',
      ms: Math.round(performance.now() - started),
      error: timedOut ? `no response within ${timeoutMs / 1000}s` : (err?.cause?.code || err?.message || String(err)),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(res, untilMatch) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > MAX_BYTES) { await reader.cancel(); throw new Error(`response larger than ${MAX_BYTES / 1024 / 1024} MB`); }
    if (untilMatch && untilMatch(text)) { await reader.cancel().catch(() => {}); break; }
  }
  return text + decoder.decode();
}

export function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
