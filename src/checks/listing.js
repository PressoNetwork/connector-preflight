// Listing URLs the portal asks for. Only checked when you pass them.

import { request } from '../http.js';

export async function checkListingUrl(rule, url, timeoutMs) {
  if (!url) return undefined;
  let parsed;
  try { parsed = new URL(url); } catch { return { rule, status: 'fail', detail: `"${url}" is not a valid URL.` }; }
  if (parsed.protocol !== 'https:') return { rule, status: 'fail', detail: `${url} is not HTTPS.` };
  const res = await request(url, { headers: { accept: 'text/html' }, timeoutMs, follow: true });
  if (!res.ok) return { rule, status: 'fail', detail: `${url}: ${res.error}.` };
  if (res.status >= 200 && res.status < 300) return { rule, status: 'pass', detail: `${url} (HTTP ${res.status})` };
  return { rule, status: 'fail', detail: `${url} returned HTTP ${res.status}.` };
}
