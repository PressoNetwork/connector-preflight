# Changelog

## 0.1.1 (30/10/2026)

All six source pages re-read on 30/10/2026.

- Fix: `--json` now works as a shorthand for `--format json`. The text report already told people to "use --json for all" when a list was cut short, but the flag was rejected and the run exited 2.
- Rules: the MCP specification's Tools page changed on 28/10/2026 (modelcontextprotocol/modelcontextprotocol#3462, an embedded-resource example moved its `annotations`). No requirement this tool checks moved. The other five source pages are unchanged. `sources.lock.json` refreshed and `RULES_CHECKED` set to 30/10/2026.

## 0.1.0 (25/10/2026)

First release. Rules checked against Claude's docs on 25/10/2026.

- Transport: HTTPS and Streamable HTTP initialize, JSON and SSE responses, session ids, paginated listing.
- OAuth discovery: 401 challenge, `resource_metadata` pointer and well-known fallback, exact `resource` match, first `authorization_servers` entry, RFC 8414 and OIDC metadata, S256 PKCE, DCR or CIMD, form-encoded token endpoint, `invalid_grant`, latency limits (10 seconds, 30 for refresh).
- Tools: titles, read-only and destructive hints, name length, characters and uniqueness, descriptions, catch-all request tools, freeform query tools, instruction-like wording, hidden or encoded text, parameter descriptions, unsupported use cases.
- MCP App detection with the carousel screenshot spec; listing URL checks; a printed manual checklist.
- Text, JSON and markdown reports; GitHub Action; Claude Code plugin.
- Weekly rules-watch job against the source pages.
- Exit codes 0 ready, 1 blocking, 2 could not run, 3 not finished. A token is never sent to a non-HTTPS remote host.
