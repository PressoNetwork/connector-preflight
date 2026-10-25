# Security

connector-preflight is read-only against the server you point it at: it sends `initialize`, `tools/list` and `resources/list`, reads OAuth metadata, and sends one refresh request with a made-up token (skip it with `--no-token-probe`). It never calls a tool or registers an OAuth client. A token you pass is sent only to the server URL you give, as a bearer token, and is never logged or written to the report.

To report a vulnerability, use GitHub's private reporting (Security tab, then "Report a vulnerability") rather than a public issue. We aim to reply within three working days.
