#!/usr/bin/env node
// Re-reads every page the rules come from and compares it with the copy recorded in sources.lock.json.
// Exit 0: nothing moved. Exit 1: a page changed (details on stdout, for the issue body). Exit 2: a page could not be read.
// --update rewrites the lock file after a maintainer has reviewed the rules against the new pages.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../src/rules.js';

const LOCK = new URL('../sources.lock.json', import.meta.url);
const update = process.argv.includes('--update');

const normalise = (text) => text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();

let lock = {};
try { lock = JSON.parse(readFileSync(LOCK, 'utf8')); } catch { /* first run */ }

const changed = [];
const failed = [];
const next = {};

for (const [key, src] of Object.entries(SOURCES)) {
  const res = await fetch(src.url, { headers: { accept: 'text/markdown, text/plain, text/html' } }).catch((err) => ({ ok: false, statusText: err.message }));
  if (!res.ok) { failed.push(`${src.url}: ${res.status || ''} ${res.statusText}`.trim()); next[key] = lock[key]; continue; }
  const text = normalise(await res.text());
  const sha256 = createHash('sha256').update(text).digest('hex');
  next[key] = { url: src.url, sha256, lines: text.split('\n').length };
  if (lock[key] && lock[key].sha256 !== sha256) changed.push({ key, ...src, before: lock[key].lines, after: next[key].lines });
}

if (update) {
  writeFileSync(LOCK, `${JSON.stringify(next, null, 2)}\n`);
  console.log('sources.lock.json updated.');
  process.exit(0);
}

if (failed.length) console.log(`Could not read:\n${failed.map((f) => `- ${f}`).join('\n')}\n`);
if (changed.length) {
  console.log('These source pages changed since the rules were last checked:\n');
  for (const c of changed) console.log(`- [${c.title}](${c.url}) (${c.before} lines before, ${c.after} now)`);
  console.log('\nTo do: read each page, update src/rules.js and the tests if a requirement moved, bump RULES_CHECKED, then run `node scripts/watch-sources.mjs --update` and release.');
  process.exit(1);
}
process.exit(failed.length ? 2 : 0);
