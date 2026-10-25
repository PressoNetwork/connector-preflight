# connector-preflight

**Will Claude's connectors directory accept your MCP server? Find out in 30 seconds, before you submit.**

[![ci](https://github.com/PressoNetwork/connector-preflight/actions/workflows/ci.yml/badge.svg)](https://github.com/PressoNetwork/connector-preflight/actions/workflows/ci.yml)
[![rules checked](https://img.shields.io/badge/rules%20checked-25%2F10%2F2026-blue)](sources.lock.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

```bash
npx -y github:PressoNetwork/connector-preflight https://mcp.example.com/mcp
```

It connects to your remote MCP server the way Claude does, walks the OAuth discovery chain, reads every tool, and checks the lot against Anthropic's published directory requirements. Each failure tells you what to change and links to the page the rule comes from.

- **Read-only.** It initialises and lists. It never calls a tool, reads a resource or registers an OAuth client.
- **Zero dependencies.** Node 20 or later.
- **Sourced.** Every rule cites a public page (Claude's docs, the MCP spec, or for one advisory check OpenAI's tool-metadata guide). A weekly job re-reads those pages and opens an issue within a week of any change.

## What it catches

```text
Authentication
  ✖ Metadata "resource" equals the server URL exactly
      "resource" is "https://mcp.example.com/mcp/" but the server URL is "https://mcp.example.com/mcp".
      The only difference is a trailing slash, and that still fails.
      fix: Set "resource" to the exact URL users paste into Claude, including the path.
      source: https://claude.com/docs/connectors/building/authentication

Tools
  ✖ Every tool has a title
      2 of 3 tools have no title.
        · api_request
        · void_invoice
  ✖ Read and write are separate tools (no catch-all api_request)
      1 tool taking both safe and unsafe HTTP methods.
        · api_request
  ! Descriptions describe the tool, they do not instruct Claude
      1 description reading like instructions to Claude. Check each one; this is a pattern match, not a verdict.
        · api_request: tells Claude when to call tools in general ("Always call this tool before any other tool")

5 blocking issues, 4 warnings, 2 notes.
```

| Area | Checks |
| --- | --- |
| Transport | HTTPS; answers `initialize` over Streamable HTTP (JSON or SSE); names a redirect if there is one |
| OAuth discovery | Sign-in starts from a `401`, not a `200`; `WWW-Authenticate` points at `resource_metadata`; protected resource metadata found; `resource` equals the server URL exactly; first `authorization_servers` entry resolves; RFC 8414 or OIDC metadata reachable; S256 PKCE advertised; Claude can register itself (DCR, or CIMD with `none` in `token_endpoint_auth_methods_supported`); token endpoint accepts form encoding; dead refresh tokens get `invalid_grant` (when the server lets an unknown client get that far); discovery and token endpoints answer inside Claude's limits (10 seconds, 30 for refresh) |
| Tools | `title` on every tool; `readOnlyHint` or `destructiveHint` declared, and not contradictory; names 64 characters or fewer, safe characters, unique; an object `inputSchema`; descriptions present and specific; no catch-all request tool mixing GET with POST/PUT/PATCH/DELETE; freeform query tools name their API; no instruction-like wording, invisible Unicode or encoded blobs; parameters described; no unsupported use cases (moving money, AI media generation) |
| MCP Apps | Detects `ui://` resources and reminds you of the carousel screenshot spec |
| Listing | Privacy policy and documentation URLs load over HTTPS (pass `--privacy-url` and `--docs-url`) |
| By hand | Prints the checklist a script cannot verify: reviewer test account, redirect URIs, response quality, listing text, compliance acknowledgments |

Rules come from [Submit a connector](https://claude.com/docs/connectors/building/submission), the [pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria), [Authentication for connectors](https://claude.com/docs/connectors/building/authentication) and the [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). Passing here does not guarantee a listing: Anthropic decides. It means you will not be turned away for something a script could have told you.

## Servers that need sign-in

If `tools/list` needs an account, the report says so and stops short of the tool checks. Pass a short-lived access token through the environment:

```bash
MCP_PREFLIGHT_TOKEN=<token> npx -y github:PressoNetwork/connector-preflight https://mcp.example.com/mcp
```

## In CI

Run it on every deploy, so a renamed tool or a lost annotation never reaches the directory:

```yaml
- uses: PressoNetwork/connector-preflight@v0
  with:
    url: https://mcp.example.com/mcp
    token: ${{ secrets.MCP_PREFLIGHT_TOKEN }}   # optional
    privacy-url: https://example.com/privacy     # optional
```

The job summary shows the full report as a table. The job fails on blocking issues unless you set `fail-on-blocking: 'false'`, and warns (without failing) when the tools could not be checked for want of a token. Outputs: `blocking` and `ready`. It uses the runner's own Node.js and leaves your job's Node version alone.

## In Claude Code

Install it as a plugin, then ask Claude to preflight your server. It runs the checker, fixes what fails in your server's code, and runs it again.

```text
/plugin marketplace add PressoNetwork/connector-preflight
/plugin install connector-preflight@connector-preflight
```

## Options

```text
--token <token>        Access token for servers that need sign-in (or MCP_PREFLIGHT_TOKEN)
--privacy-url <url>    Privacy policy URL for the listing
--docs-url <url>       Documentation URL for the listing
--format <fmt>         text (default), json or markdown
--markdown-out <file>  Also append a markdown report to a file
--verbose              Show detail for passing checks
--no-token-probe       Skip the invalid refresh-token request to your token endpoint
--no-fail              Exit 0 even with blocking issues or unchecked tools
--timeout <seconds>    Per-request timeout (default 15)
```

Exit codes: `0` ready, `1` blocking issues, `2` could not run (bad URL or no MCP server there), `3` not finished (the tools need sign-in and no working token was given).

The one request that touches your authorization server's token endpoint is a refresh with a made-up token and a made-up client ID. It cannot succeed and changes nothing; it is how the checker confirms form encoding and the `invalid_grant` error code. Turn it off with `--no-token-probe`.

## How the rules stay current

Anthropic's review rules change. Every Monday, [rules-watch](.github/workflows/rules-watch.yml) re-reads each source page and compares it with [sources.lock.json](sources.lock.json). If one moved, it opens an issue, and the rules, tests and the "rules checked" date are updated in a release. Spotted a rule we missed, or a false positive? [Open an issue](https://github.com/PressoNetwork/connector-preflight/issues/new/choose).

## Why we built it

We run MCP servers in production at Presso Network: [Presso Events](https://presso.events) (ticketing and check-in), Presso Homes (home search, as an MCP App) and [Corey](https://getcorey.ai) (an AI co-founder). Getting them directory-ready meant reading the same four pages again and again, for rules that are easy to break without noticing: a `resource` value one trailing slash away from the server URL, a write tool with no `destructiveHint`, a parameter Claude has to guess at. This is that checklist, made runnable. We ran it on our own servers first, and it found things to fix in two of them.

Maintained by [Kristian Papadakis](https://github.com/kristian-presso) at [Presso Network](https://pressonetwork.com). If you want your product usable from Claude and would rather not build the connector yourself, [we do that too](https://pressonetwork.com).

## Licence

MIT
