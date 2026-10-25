// Static checks on the tool list, against the directory's review criteria.
// Pure functions: given tools/list output, return findings. No network.

const SAFE = ['GET', 'HEAD', 'OPTIONS'];
const UNSAFE = ['POST', 'PUT', 'PATCH', 'DELETE'];
const NAME_OK = /^[A-Za-z0-9_.-]+$/;

// Zero-width and formatting characters, bidi overrides and isolates (Trojan Source), soft hyphen, BOM and
// Unicode tag characters. U+200D (zero-width joiner) is left out on purpose: emoji sequences use it.
const HIDDEN = /[\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
const ENCODED_BLOB = /[A-Za-z0-9+/]{80,}={0,2}/;
const URLS = /https?:\/\/\S+/gi;

const INJECTION = [
  { re: /\bignore\b[^.]{0,30}\b(previous|prior|above|earlier|other|system)\b[^.]{0,20}\b(instructions?|prompts?|rules)\b/i, why: 'tells Claude to ignore instructions' },
  { re: /\b(system prompt|system instructions?|developer message)\b/i, why: 'refers to Claude\'s system instructions' },
  { re: /\b(do not|don't|never)\s+(use|call|invoke)\s+(any\s+)?(other|another)\s+tools?\b/i, why: 'steers Claude away from other tools' },
  { re: /\b(instead of|rather than)\s+(using|calling)\s+(any\s+)?(other|another)\b[^.]{0,30}\btools?\b/i, why: 'steers Claude away from other tools' },
  { re: /\b(always|must|first)\b[^.]{0,25}\b(call|use|invoke|run)\b[^.]{0,25}\b(before|after)\b[^.]{0,20}\b(any|every|each|other)\b[^.]{0,15}\b(tool|request|message|response)s?\b/i, why: 'tells Claude when to call tools in general' },
  { re: /\b(fetch|read|load|follow|obey)\b[^.]{0,20}\b(instructions|rules|guidelines|directives)\b[^.]{0,15}\b(from|at)\b/i, why: 'points Claude at instructions held elsewhere' },
  { re: /\b(you are now|from now on,? you|your new role is|act as (an?|the) (assistant|ai|agent|model|chatbot)|pretend to be)\b/i, why: 'tries to set Claude\'s behaviour or role' },
  { re: /\b(do not|don't|never)\s+(tell|mention|reveal|show)\b[^.]{0,20}\b(the user|users)\b/i, why: 'asks Claude to hide something from the user' },
];

// A freeform query tool takes a caller-built query or endpoint. A bare "path" or "body" is common in
// ordinary tools (files, email), so it only counts alongside a method or url-like parameter.
const QUERY_STRONG = /^(endpoint|api_path|url_path|sql|graphql|raw_query|query_string|request_body|http_body)$/i;
const QUERY_WEAK = /^(path|body)$/i;
const METHOD_PARAMS = /^(method|http_method|verb|http_verb)$/i;
const URLISH_PARAMS = /^(url|uri|path|endpoint|api_path|url_path)$/i;
const REQUEST_NAME = /(^|[_.-])(request|http|api|fetch)([_.-]|$)/i;

// A named API: "Slack Web API", "Acme API". "the API", "The API", "a REST API" do not count;
// the review docs give "Makes a request to the API" as a failing example.
const NAMED_API = /\b(?!(?:The|A|An|This|That|Our|Your|REST|HTTP|HTTPS|JSON|Web|Public|Internal)\b)[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*)*\s+API\b/;

const MONEY = /\b(transfer|send|wire|withdraw|payout|remit)_?(money|funds|payment|crypto|usdc|btc|eth)\b|\b(swap|bridge)_?(token|crypto)s?\b/i;
const MEDIA = /\b(generate|create|make)_?(image|picture|photo|video|audio|speech|voice|music|song)s?\b|\btext_?to_?(image|video|speech|audio)\b/i;

const n = (count, word, plural = `${word}s`) => `${count} ${count === 1 ? word : plural}`;
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const toolTitle = (t) => str(t.title || t.annotations?.title).trim();

// Turn whatever the server sent into tools we can reason about without crashing.
export function normaliseTools(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({
      ...t,
      name: str(t.name),
      description: str(t.description),
      annotations: t.annotations && typeof t.annotations === 'object' ? t.annotations : {},
    }));
}

function props(t) {
  const p = t.inputSchema?.properties;
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

function methodValues(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const vals = schema.enum || schema.items?.enum || [...(schema.anyOf || []), ...(schema.oneOf || [])].flatMap((s) => s?.enum || (s?.const ? [s.const] : []));
  return (Array.isArray(vals) ? vals : []).map((v) => String(v).toUpperCase());
}

export function checkTools(rawTools) {
  const tools = normaliseTools(rawTools);
  const findings = [];
  const add = (rule, status, detail, items) => findings.push({ rule, status, detail, items });
  const list = (arr) => arr.map((t) => t.name || '(unnamed)');

  add('tools.listed', 'pass', `${n(tools.length, 'tool')}.`);
  if (!tools.length) return findings;

  const noTitle = tools.filter((t) => !toolTitle(t));
  add('tools.title', noTitle.length ? 'fail' : 'pass', noTitle.length ? `${noTitle.length} of ${n(tools.length, 'tool')} ${noTitle.length === 1 ? 'has' : 'have'} no title.` : 'All tools have a title.', list(noTitle));

  const a = (t) => t.annotations;
  const noHint = tools.filter((t) => typeof a(t).readOnlyHint !== 'boolean' && typeof a(t).destructiveHint !== 'boolean');
  add('tools.hint', noHint.length ? 'fail' : 'pass', noHint.length ? `${noHint.length} of ${n(tools.length, 'tool')} ${noHint.length === 1 ? 'declares' : 'declare'} neither readOnlyHint nor destructiveHint.` : 'Every tool declares a hint.', list(noHint));

  const vagueWrite = tools.filter((t) => a(t).readOnlyHint === false && typeof a(t).destructiveHint !== 'boolean');
  if (vagueWrite.length) add('tools.hint-explicit-write', 'fail', `${n(vagueWrite.length, 'write tool')} ${vagueWrite.length === 1 ? 'leaves' : 'leave'} destructiveHint unset.`, list(vagueWrite));

  const both = tools.filter((t) => a(t).readOnlyHint === true && a(t).destructiveHint === true);
  add('tools.hint-contradiction', both.length ? 'fail' : 'pass', both.length ? `${n(both.length, 'tool')} marked both read-only and destructive.` : 'No contradictions.', list(both));

  const long = tools.filter((t) => t.name.length > 64);
  add('tools.name-length', long.length ? 'fail' : 'pass', long.length ? `${n(long.length, 'name')} over 64 characters.` : `Longest name: ${Math.max(...tools.map((t) => t.name.length))} characters.`, long.map((t) => `${t.name} (${t.name.length})`));

  const badChars = tools.filter((t) => !NAME_OK.test(t.name));
  add('tools.name-charset', badChars.length ? 'fail' : 'pass', badChars.length ? `${n(badChars.length, 'name')} with other characters, or empty.` : 'All names use safe characters.', list(badChars));

  const seen = new Map();
  for (const t of tools) seen.set(t.name, (seen.get(t.name) || 0) + 1);
  const dupes = [...seen].filter(([, c]) => c > 1).map(([name]) => name);
  add('tools.name-unique', dupes.length ? 'fail' : 'pass', dupes.length ? `${n(dupes.length, 'duplicated name')}.` : 'All names unique.', dupes);

  const badSchema = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object' || Array.isArray(t.inputSchema) || (t.inputSchema.type !== undefined && t.inputSchema.type !== 'object'));
  add('tools.input-schema', badSchema.length ? 'fail' : 'pass', badSchema.length ? `${n(badSchema.length, 'tool')} with a missing or non-object inputSchema.` : 'Every inputSchema is an object.', list(badSchema));

  const noDesc = tools.filter((t) => !t.description.trim());
  add('tools.description', noDesc.length ? 'fail' : 'pass', noDesc.length ? `${n(noDesc.length, 'tool')} with no description.` : 'All tools have a description.', list(noDesc));

  const short = tools.filter((t) => t.description.trim() && t.description.trim().length < 30);
  if (short.length) add('tools.description-short', 'fail', `${n(short.length, 'description')} under 30 characters.`, short.map((t) => `${t.name}: "${t.description.trim()}"`));

  const catchAll = tools.filter((t) => {
    const p = props(t);
    const keys = Object.keys(p);
    return keys.some((k) => {
      if (!METHOD_PARAMS.test(k)) return false;
      const vals = methodValues(p[k]);
      if (vals.length) return vals.some((v) => SAFE.includes(v)) && vals.some((v) => UNSAFE.includes(v));
      // No enum: only a request-shaped tool that also takes a url or path counts.
      return REQUEST_NAME.test(t.name) && keys.some((other) => URLISH_PARAMS.test(other));
    });
  });
  add('tools.catch-all', catchAll.length ? 'fail' : 'pass', catchAll.length ? `${n(catchAll.length, 'tool')} taking both safe and unsafe HTTP methods.` : 'No catch-all request tools.', list(catchAll));

  const freeform = tools.filter((t) => {
    const keys = Object.keys(props(t));
    const isQuery = keys.some((k) => QUERY_STRONG.test(k))
      || (keys.some((k) => QUERY_WEAK.test(k)) && keys.some((k) => METHOD_PARAMS.test(k) || /^(url|uri|endpoint)$/i.test(k)));
    return isQuery && !/https?:\/\//i.test(t.description) && !NAMED_API.test(t.description);
  });
  if (freeform.length) add('tools.custom-query-docs', 'fail', `${n(freeform.length, 'tool')} taking freeform endpoints, queries or bodies without naming or linking the API.`, list(freeform));

  const injected = [];
  const hidden = [];
  for (const t of tools) {
    const text = [t.description, toolTitle(t), ...Object.values(props(t)).map((s) => str(s?.description))].join('\n');
    const hit = INJECTION.find((p) => p.re.test(text));
    if (hit) injected.push(`${t.name}: ${hit.why} ("${text.match(hit.re)[0].trim()}")`);
    if (HIDDEN.test(text)) hidden.push(`${t.name}: invisible or direction-changing Unicode characters`);
    else if (ENCODED_BLOB.test(text.replace(URLS, ' '))) hidden.push(`${t.name}: a long encoded-looking string`);
  }
  add('tools.injection', injected.length ? 'fail' : 'pass', injected.length ? `${n(injected.length, 'description')} reading like instructions to Claude. Check each one; this is a pattern match, not a verdict.` : 'No instruction-like wording found.', injected);
  add('tools.hidden-text', hidden.length ? 'fail' : 'pass', hidden.length ? `${n(hidden.length, 'tool')} carrying hidden or encoded text.` : 'No hidden or encoded text.', hidden);

  const missingParamDesc = tools
    .map((t) => ({ t, missing: Object.entries(props(t)).filter(([, s]) => !str(s?.description).trim()).map(([k]) => k) }))
    .filter((x) => x.missing.length);
  if (missingParamDesc.length) {
    const total = missingParamDesc.reduce((c, x) => c + x.missing.length, 0);
    add('tools.param-descriptions', 'fail', `${n(total, 'parameter')} across ${n(missingParamDesc.length, 'tool')} with no description.`, missingParamDesc.map((x) => `${x.t.name}: ${x.missing.join(', ')}`));
  } else {
    add('tools.param-descriptions', 'pass', 'Every parameter is described.');
  }

  const unsupported = tools.filter((t) => MONEY.test(t.name) || MEDIA.test(t.name));
  if (unsupported.length) add('tools.unsupported-use', 'fail', `${n(unsupported.length, 'tool name')} suggesting an unsupported use case.`, list(unsupported));

  return findings;
}

export function detectMcpApp(rawTools, resources) {
  const tools = normaliseTools(rawTools);
  const uiTools = tools.filter((t) => {
    const m = t._meta && typeof t._meta === 'object' ? t._meta : {};
    return m['ui/resourceUri'] || m.ui?.resourceUri || m['openai/outputTemplate'];
  });
  const uiResources = (Array.isArray(resources) ? resources : []).filter((r) => str(r?.uri).startsWith('ui://'));
  return { isApp: uiTools.length > 0 || uiResources.length > 0, uiTools: uiTools.map((t) => t.name), uiResources: uiResources.map((r) => str(r.uri)) };
}
