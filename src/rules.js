// Every rule this tool enforces, with the page it comes from and the date that page was last read.
// The weekly rules-watch workflow re-reads these pages and opens an issue when one changes.

export const RULES_CHECKED = '30/10/2026';

export const SOURCES = {
  submission: {
    title: 'Claude docs: Submit a connector to the directory',
    url: 'https://claude.com/docs/connectors/building/submission',
  },
  review: {
    title: 'Claude docs: Connector pre-submission checklist',
    url: 'https://claude.com/docs/connectors/building/review-criteria',
  },
  auth: {
    title: 'Claude docs: Authentication for connectors',
    url: 'https://claude.com/docs/connectors/building/authentication',
  },
  spec: {
    title: 'MCP specification 2025-11-25: Tools',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools',
  },
  schema: {
    title: 'MCP specification 2025-11-25: schema reference (ToolAnnotations)',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/schema',
  },
  metadata: {
    title: 'OpenAI Apps docs: Optimize metadata (how assistants choose tools)',
    url: 'https://developers.openai.com/plugins/guides/optimize-metadata',
  },
};

// level: error = the directory rejects or flags it; warn = likely to hurt review or use; info = good to know.
export const RULES = {
  'transport.https': {
    level: 'error', source: 'submission',
    title: 'Server URL uses HTTPS',
    fix: 'The portal only accepts an https:// URL. Put the server behind TLS.',
  },
  'transport.reachable': {
    level: 'error', source: 'submission',
    title: 'Server answers an MCP initialize request',
    fix: 'POST an initialize request to the URL and make sure it returns JSON-RPC (application/json or text/event-stream), or a 401 that starts sign-in.',
  },
  'auth.401-required': {
    level: 'warn', source: 'auth',
    title: 'Sign-in is started with a 401, not a 200',
    fix: 'Claude ignores WWW-Authenticate on a 200. Return 401 for calls that need the user\'s account.',
  },
  'auth.resource-metadata-pointer': {
    level: 'warn', source: 'auth',
    title: '401 carries WWW-Authenticate: Bearer resource_metadata="..."',
    fix: 'Add WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource" to the 401. Without it Claude falls back to probing /.well-known paths on your origin, which works only if your platform serves them.',
  },
  'auth.prm-found': {
    level: 'error', source: 'auth',
    title: 'Protected resource metadata (RFC 9728) is reachable',
    fix: 'Serve the protected resource metadata JSON and point to it from the 401. With no metadata, Claude never learns where your authorization server is and the connection fails with "Couldn\'t reach the MCP server".',
  },
  'auth.resource-matches': {
    level: 'error', source: 'auth',
    title: 'Metadata "resource" equals the server URL exactly',
    fix: 'Set "resource" to the exact URL users paste into Claude, including the path.',
  },
  'auth.authorization-servers': {
    level: 'error', source: 'auth',
    title: 'Metadata lists an authorization server',
    fix: 'Add "authorization_servers": ["https://<issuer>"]. Claude uses only the first entry and never falls back to later ones.',
  },
  'auth.as-metadata': {
    level: 'error', source: 'auth',
    title: 'Authorization server metadata is reachable (RFC 8414 or OpenID Connect Discovery)',
    fix: 'Serve /.well-known/oauth-authorization-server or /.well-known/openid-configuration for the issuer, reachable from Anthropic\'s egress range (160.79.104.0/21).',
  },
  'auth.pkce-s256': {
    level: 'error', source: 'auth',
    title: 'Advertises S256 PKCE',
    fix: 'Claude sends code_challenge_method=S256 on every request. Support it and advertise "code_challenge_methods_supported": ["S256"].',
  },
  'auth.client-registration': {
    level: 'warn', source: 'auth',
    title: 'Claude can register itself (DCR or Client ID Metadata Document)',
    fix: 'Expose a registration_endpoint (DCR), or advertise "client_id_metadata_document_supported": true together with "none" in token_endpoint_auth_methods_supported (CIMD). Otherwise you must enter an OAuth client in the developer portal (Anthropic-held credentials).',
  },
  'auth.dcr-at-scale': {
    level: 'info', source: 'auth',
    title: 'High traffic: prefer CIMD or Anthropic-held credentials over DCR',
    fix: 'DCR registers a new client on every fresh connection. For a busy directory listing, CIMD or Anthropic-held credentials avoid a pile-up of clients on your authorization server.',
  },
  'auth.latency': {
    level: 'error', source: 'auth',
    title: 'OAuth endpoints answer inside Claude\'s time limits',
    fix: 'Claude gives discovery, registration and token endpoints 10 seconds, and refresh requests 30. Aim well under both; slow endpoints cause intermittent connection failures.',
  },
  'auth.token-form-encoded': {
    level: 'error', source: 'auth',
    title: 'Token endpoint accepts application/x-www-form-urlencoded',
    fix: 'Register a form-urlencoded body parser on /token. Claude sends the code exchange and every refresh in that format; a 415 breaks sign-in.',
  },
  'auth.invalid-grant': {
    level: 'warn', source: 'auth',
    title: 'Dead refresh tokens get the RFC 6749 error "invalid_grant"',
    fix: 'Return {"error":"invalid_grant"} when a refresh token is no longer valid, not invalid_request or a custom code.',
  },
  'auth.token-accepted': {
    level: 'error', source: 'auth',
    title: 'The access token you passed is accepted',
    fix: 'The server refused the token passed with --token. Use a fresh access token for this server, and check it is sent as "Authorization: Bearer <token>".',
  },
  'auth.offline-access': {
    level: 'info', source: 'auth',
    title: 'offline_access in scopes_supported, so Claude gets a refresh token',
    fix: 'If you want long-lived connections, list offline_access in the authorization server\'s scopes_supported.',
  },
  'tools.listed': {
    level: 'info', source: 'submission',
    title: 'Tools sync from the server',
    fix: 'The portal reads your tools straight from the server. Anything not listed by tools/list is not reviewed.',
  },
  'tools.title': {
    level: 'error', source: 'review',
    title: 'Every tool has a title',
    fix: 'Add "title" (top level or in annotations) to every tool. The portal flags tools without one.',
  },
  'tools.hint': {
    level: 'error', source: 'review',
    title: 'Every tool declares readOnlyHint or destructiveHint',
    fix: 'Set annotations.readOnlyHint: true on read-only tools and annotations.destructiveHint: true on tools that change or delete data. These decide auto-permissions in Claude.',
  },
  'tools.hint-explicit-write': {
    level: 'warn', source: 'schema',
    title: 'Write tools say destructiveHint explicitly',
    fix: 'A tool with readOnlyHint: false should also say destructiveHint: true or false. Left unset, the MCP schema defaults it to true.',
  },
  'tools.hint-contradiction': {
    level: 'warn', source: 'schema',
    title: 'No tool is both read-only and destructive',
    fix: 'When readOnlyHint is true, destructiveHint is ignored, so this tool is treated as read-only. Remove whichever hint is not true.',
  },
  'tools.name-length': {
    level: 'error', source: 'review',
    title: 'Tool names are 64 characters or fewer',
    fix: 'Shorten the name. The directory requires tool names of 64 characters or fewer.',
  },
  'tools.name-charset': {
    level: 'warn', source: 'spec',
    title: 'Tool names use only A-Z, a-z, 0-9, _, - and .',
    fix: 'Rename the tool to use letters, digits, underscore, hyphen or dot. Underscore is the safest choice across clients.',
  },
  'tools.name-unique': {
    level: 'warn', source: 'spec',
    title: 'Tool names are unique',
    fix: 'Two tools share a name. Rename one.',
  },
  'tools.input-schema': {
    level: 'error', source: 'spec',
    title: 'Every tool has an object inputSchema',
    fix: 'inputSchema must be a JSON Schema object. For a tool with no parameters use { "type": "object", "additionalProperties": false }.',
  },
  'tools.description': {
    level: 'warn', source: 'review',
    title: 'Every tool has a description',
    fix: 'Say precisely what the tool does and when to use it. The description must match what the tool actually does.',
  },
  'tools.description-short': {
    level: 'warn', source: 'review',
    title: 'Descriptions say what the tool does and when to use it',
    fix: 'This description is very short. Reviewers and Claude pick tools from it alone; say what it does and when to call it.',
  },
  'tools.catch-all': {
    level: 'error', source: 'review',
    title: 'Read and write are separate tools (no catch-all api_request)',
    fix: 'A tool that takes both safe (GET) and unsafe (POST, PUT, PATCH, DELETE) methods is rejected. Split it into a read-only tool and write tools, ideally one per action.',
  },
  'tools.custom-query-docs': {
    level: 'warn', source: 'review',
    title: 'Freeform query tools name or link the target API',
    fix: 'If this tool takes caller-built paths, queries or bodies, its description must link to or name the API, for example "Queries the Slack Web API, see https://api.slack.com/methods".',
  },
  'tools.injection': {
    level: 'warn', source: 'review',
    title: 'Descriptions describe the tool, they do not instruct Claude',
    fix: 'Remove wording that tells Claude how to behave, steers it away from other tools, or points it at instructions elsewhere. Describe what the tool does.',
  },
  'tools.hidden-text': {
    level: 'error', source: 'review',
    title: 'No hidden, obfuscated or encoded text in descriptions',
    fix: 'Remove zero-width or invisible Unicode and encoded blobs from tool descriptions. Reviewers reject them on sight.',
  },
  'tools.param-descriptions': {
    level: 'info', source: 'metadata',
    title: 'Every parameter has a description',
    fix: 'Describe each input parameter, include examples, and list the allowed values for constrained inputs (an enum). Assistants choose and fill tools from this metadata alone.',
  },
  'tools.unsupported-use': {
    level: 'warn', source: 'review',
    title: 'No unsupported use cases (moving money, AI image, video or audio generation)',
    fix: 'The directory does not accept connectors that transfer money, crypto or other financial assets, or that generate images, video or audio with AI models. Diagrams, charts and UI mockups are fine. Check this tool really falls outside those.',
  },
  'apps.screenshots': {
    level: 'info', source: 'submission',
    title: 'MCP App detected: prepare carousel screenshots',
    fix: '3 to 5 PNGs, at least 1000px wide, cropped to the app response without the prompt, each with its prompt text supplied separately. No video or GIF.',
  },
  'listing.privacy-url': {
    level: 'error', source: 'submission',
    title: 'Privacy policy URL loads over HTTPS',
    fix: 'The portal\'s Listing step asks for a privacy policy URL. Make sure it loads and covers what the connector collects.',
  },
  'listing.docs-url': {
    level: 'error', source: 'review',
    title: 'Documentation URL loads over HTTPS',
    fix: 'Public setup and usage documentation is required by your publish date. A blog post or help-centre article is enough.',
  },
};

export const MANUAL_CHECKS = [
  { source: 'review', text: 'Test credentials for a fully populated account, entered in the portal for reviewers only.' },
  { source: 'submission', text: 'Every tool run by you, as a custom connector in Claude or through MCP Inspector (the Test & launch step asks you to confirm).' },
  { source: 'auth', text: 'Redirect URI https://claude.ai/api/mcp/auth_callback registered, plus port-agnostic loopback redirects for http://localhost/callback and http://127.0.0.1/callback (Claude Code).' },
  { source: 'review', text: 'Every tool returns a useful result with valid input, and an actionable error (not a bare "Internal Server Error") with bad input.' },
  { source: 'review', text: 'Responses sized for the task, and no collection of conversation data beyond what the tool needs.' },
  { source: 'review', text: 'The server calls your own APIs (or ones you proxy with permission), and its domain matches your service.' },
  { source: 'submission', text: 'Listing ready: name up to 100 characters, one-liner up to 200, description up to 2,000, 1 to 5 categories, icon, support contact. The URL slug is permanent once published.' },
  { source: 'submission', text: 'Directory Terms and Policy read, and the seven compliance acknowledgments ready to tick.' },
];
