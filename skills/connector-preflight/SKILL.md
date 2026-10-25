---
name: connector-preflight
description: Check a remote MCP server against the Claude connectors directory requirements and fix what fails in the server's code. Use when the user says "is my MCP server ready for the directory", "preflight my connector", "why was my connector rejected", "check my MCP OAuth", "submit my MCP to Claude", or before submitting a remote MCP server to claude.ai/directory/manage. Not for building a server from scratch or for local (stdio) servers.
---

# Connector preflight

Run the checker, read what failed, fix it in the server's own code, run it again. The checker is read-only against the server: it initialises and lists, and never calls a tool.

## 1. Get the URL

Ask for the server's public `https://` URL if you do not have it, exactly as users will paste it into Claude (path included). A local `http://localhost` URL works for a dry run, but expect the HTTPS check to fail.

## 2. Run it

```bash
npx -y github:PressoNetwork/connector-preflight#v0.1.0 <url> --format json
```

- If the server needs sign-in for `tools/list`, the report says the tools were not checked. Ask the user for a short-lived access token, then pass it through the environment, never on a command line that ends up in their shell history: `MCP_PREFLIGHT_TOKEN=<token> npx -y github:PressoNetwork/connector-preflight#v0.1.0 <url> --format json`.
- Add `--privacy-url` and `--docs-url` when the user has them.

## 3. Read the report

`counts.blocking` is what the directory rejects or flags. Each finding has `rule`, `status`, `level`, `detail` and sometimes `items` (the tool names). `pass` and `skip` need nothing. Fix `error` first, then `warn`. Treat `info` as advice.

`tools.injection` is a warning from a pattern match, not a verdict. Read the quoted wording: if the description really tells Claude how to behave, rewrite it to describe what the tool does; if it is a false positive, say so and leave it.

## 4. Fix in the code

Find where the server registers its tools and OAuth metadata, and change it there. Typical fixes:

- **Missing title or hint**: add `title` and `annotations: { readOnlyHint: true }` to read-only tools, `annotations: { destructiveHint: true }` (or `false` for safe writes) to the rest. Decide from what the tool really does, not its name: anything that changes or deletes data is not read-only.
- **Catch-all request tool**: split it into a read tool and one write tool per action. Do not just reword the description.
- **`resource` mismatch**: set it to the exact server URL, path included, no trailing slash unless the URL has one.
- **No `resource_metadata` in the 401**: add `WWW-Authenticate: Bearer resource_metadata="<metadata URL>"`.
- **No registration**: add a DCR `registration_endpoint`, or CIMD (`client_id_metadata_document_supported: true` plus `"none"` in `token_endpoint_auth_methods_supported`).

Show the user the diff. Do not deploy unless they ask.

## 5. Check again and hand over

Re-run against the deployed server. Then give the user the manual checklist from the report (`manual`): test account, redirect URIs, listing text, screenshots for MCP Apps. Those cannot be checked by a script.
