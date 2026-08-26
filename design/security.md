# Security Design

Status: **Draft**

## 1. Security posture

A `.dstar` package is untrusted structured content, not an application bundle.
Opening one must not execute code, escape its directory, fetch remote resources,
invoke an agent, or mutate canonical content without explicit action.

DSTAR provenance records declared actors and decisions. It does not
cryptographically prove authorship or absence of out-of-band modification. The
reference implementation must not present provenance as a signature.

## 2. Trust boundaries

| Boundary | Trust assumption |
| --- | --- |
| Protocol core | Trusted code; all input values untrusted |
| Package filesystem | Untrusted paths, types, bytes, and sizes |
| Canonical content/comments/sources | Untrusted data and possible prompt injection |
| Stored HTML/SVG/media | Active-content and parser threat |
| Browser review app | Trusted application origin |
| Local workspace API | Trusted only with loopback/session authentication |
| Agent/model output | Untrusted suggestions and tool arguments |
| Agent-facing MCP session | Untrusted client confined to one server-held task capability |
| External source/network | Untrusted content and destination |
| Profile/renderer plugin | Trusted installed code, never package-supplied |
| Human decision actor | Locally authenticated accountable authority |

## 3. Threats

The 0.1 threat model includes:

- path traversal, symlink races, junctions, and archive extraction attacks;
- malformed/oversized JSON, deep trees, hash or parser denial of service;
- XSS, malicious links, active SVG, HTML forms, media sniffing, and CSS abuse;
- a projection attempting to call the loopback API;
- cross-site requests from an unrelated browser tab to the local service;
- prompt injection in documents, comments, sources, or fetched pages;
- agent attempts to forge a human decision or write outside its task;
- stale-snapshot and time-of-check/time-of-use writes;
- malicious profile declarations or executable package content;
- provider credential leakage through packages, logs, or prompts;
- accidental disclosure of audience-restricted comments to an agent;
- dependency compromise and unsafe plugin installation; and
- misleading provenance or UI that obscures the human commit boundary.

Remote multi-user attacks and organization-level authorization are deferred
because the first service is loopback-only, but local untrusted packages remain
fully in scope.

## 4. Package safety

The package runtime implements the controls in
[Package runtime](package-runtime.md):

- strict package-relative path parser;
- `lstat` of every component and rejection of all links/special files;
- descriptor-relative opens where supported;
- root-containment recheck;
- bounded file count, size, depth, and object counts;
- duplicate-key and I-JSON rejection;
- no archive extraction in 0.1; and
- journaled writes with expected snapshot and file hashes.

The process never changes current working directory into an untrusted package
and never constructs shell commands from package paths or IDs.

File permissions for newly written portable files follow a conservative user
read/write default. Existing broader permissions are preserved only when safe;
provider secrets are never placed nearby.

## 5. Local service security

The workspace service:

- binds only to `127.0.0.1` and `::1` unless a future explicit remote mode is
  designed;
- generates a high-entropy session token for each launch;
- requires the token on every API and event-stream request;
- uses an unpredictable origin/port and strict `Origin` validation;
- rejects cookies as the sole authentication mechanism;
- applies CSRF protection to all commands;
- accepts only JSON with bounded body size;
- sends restrictive CORS headers and never uses `*`;
- rate-limits mutation and agent-start commands; and
- shuts down the session when the owning CLI/service exits.

The token is passed to the opened application without placing it in durable
browser history or package content. Sensitive command responses use
`Cache-Control: no-store`.

### 5.1 MCP adapter security

The initial MCP server uses standard input/output and is launched with one
server-held document/task capability. It does not accept package paths, actors,
audiences, or authority levels from model tool arguments. Standard output is
reserved for protocol messages; redacted diagnostics use standard error.

Resources are bounded and audience-filtered. Agent tools can inspect permitted
context, simulate operations, reply, and submit a pending proposal, but no MCP
tool accepts, rejects, supersedes, resolves, or commits canonical content.
Tool metadata is not trusted as authorization. The adapter validates inputs and
outputs, rate-limits calls, and enforces expiry and cancellation. See
[MCP server](mcp-server.md).

If Streamable HTTP is added later, it inherits loopback binding, strict Origin
validation, per-session authentication, CSRF controls where applicable, and MCP
authorization requirements. A remote MCP service is outside the 0.1 threat
model.

## 6. HTML and projection isolation

Stored projection HTML is never navigated as the application top-level page. It
is sanitized, served with a restrictive CSP, and placed in a sandboxed frame.

Minimum controls:

```text
default-src 'none'
img-src 'self' data:
style-src 'self' 'unsafe-inline'  # only trusted generated theme CSS
font-src 'self'
script-src 'none'
connect-src 'none'
form-action 'none'
frame-ancestors 'self'
base-uri 'none'
```

The sanitizer removes scripts, handlers, forms, refresh/navigation metadata,
untrusted iframes, foreign-object SVG, active URLs, and unknown dangerous
attributes. Selection attributes are validated against the projection index.

If same-origin DOM access is used for selection, scripts remain disabled and
the projection receives no API token. A stricter isolated-origin viewer may
replace this design later if selection events are bridged explicitly.

External links open only after user action, in a new browsing context with
`noopener noreferrer`. Package rendering performs no automatic remote image,
font, stylesheet, embed, or link-preview fetch.

## 7. Asset serving

Assets are served through an opaque route that revalidates snapshot and package
path. Responses set:

- explicit allowlisted `Content-Type`;
- `X-Content-Type-Options: nosniff`;
- CSP appropriate to the media type;
- attachment disposition for unsupported/active formats; and
- bounded range behavior for supported media.

SVG is treated as potentially active. It is either rasterized by a trusted,
sandboxed converter or served only as an image under a policy that prevents
script/navigation; it is never injected as inline markup.

HTML assets are downloaded as attachments, not rendered in the trusted app
origin.

## 8. Agent isolation and least privilege

The agent runtime exposes DSTAR-specific brokered tools only. Default agent
capabilities exclude:

- shell/process execution;
- arbitrary filesystem paths;
- direct package writes;
- human decision tools;
- unrestricted network access;
- secrets or provider configuration; and
- hidden comments excluded by audience metadata.

Every tool validates actor, task, IDs, limits, and current snapshot. Model prose
has no authority; only valid tool calls can create portable results.

External fetching is an opt-in capability per job. The user sees destination,
purpose, and data-sharing implications before authorization. Fetches enforce
scheme/host rules, DNS rebinding protection, private-network blocking, redirect
limits, response size/type limits, and timeouts.

## 9. Prompt injection

All document and source material is labeled untrusted. The provider input keeps
system policy, human task, protocol data, and external source content in
separate typed message/tool fields where supported.

Controls are defense in depth:

- sources cannot redefine system/tool rules;
- the model cannot choose actor identity or accepted status;
- read tools expose bounded semantic objects;
- output tools accept only schema-validated proposal/reply arguments;
- operation simulation and profile validation are deterministic;
- tool-call and context expansion budgets limit exfiltration and loops;
- suspicious source instructions are surfaced in local diagnostics; and
- human review remains required for canonical changes.

Human approval is not treated as a complete prompt-injection defense: the UI
must clearly display sources, scope, semantic diff, and unexpected broad changes.

## 10. Human authority and UI integrity

The application must make the commit boundary unmistakable:

- agent output is always labeled proposed;
- accept controls name the human actor and exact result revision;
- stale or invalid simulations disable acceptance;
- policy/service validation cannot appear as human approval;
- reject, supersede, resolve, and cancel remain separate actions;
- proposal preview comes from deterministic simulation, not model-generated
  explanation; and
- no “auto-accept” setting exists in 0.1.

Local human identity is configured and unlocked in the application session. It
is accountability metadata, not strong remote authentication. Strong identity,
signatures, and organization authorization require a later design.

## 11. Secrets

Provider keys and tokens live in the OS credential store where available, with
environment variables supported for CLI automation. They are:

- never serialized into packages, projections, comments, sources, or changes;
- redacted from exceptions and structured logs;
- passed only to the selected provider adapter;
- excluded from agent context and tool results; and
- deleted from memory references as soon as practical after use.

The browser never receives provider credentials. Local API session tokens and
provider keys are distinct.

## 12. Privacy and audience

Annotation `audience` is disclosure metadata, not encryption. The runtime
enforces it when assembling agent context but warns users that anyone with
filesystem access can inspect package files.

Before provider execution, the UI can show a context disclosure summary:

- selected canonical nodes/ranges;
- comments/replies;
- sources and assets;
- provider/model destination; and
- whether external fetching is enabled.

Telemetry is opt-in, content-free by default, and documented separately. Local
logs use IDs, sizes, timings, and diagnostic codes rather than bodies or source
text. A user can delete runtime jobs/logs without modifying portable history.

## 13. Resource exhaustion

Controls include:

- package and object limits;
- iterative traversal or explicit recursion-depth limits;
- bounded regex/selector work;
- streaming hashes and asset reads;
- render output limits;
- agent token/tool/time/cost budgets;
- concurrency caps per package/provider; and
- cancellation propagation.

Hashing and validation caches are keyed by trusted raw hashes but never bypass
path revalidation on a new snapshot.

## 14. Plugins and dependencies

Profile and provider plugins execute trusted code and are never installed from
a package declaration. Installation is an explicit application action showing
publisher and permissions.

The project uses lockfiles, automated vulnerability/license checks, provenance
where available, minimal dependencies in the protocol core, and reproducible
release builds. Security-sensitive parsers, sanitizers, canonicalizers, and
schema validators receive dedicated upgrade tests.

## 15. Security diagnostics and response

Security events use non-content codes such as:

```text
SEC_PATH_ESCAPE
SEC_LINK_REJECTED
SEC_ACTIVE_CONTENT_REMOVED
SEC_ORIGIN_REJECTED
SEC_SESSION_INVALID
SEC_AGENT_CAPABILITY_DENIED
SEC_EXTERNAL_FETCH_BLOCKED
SEC_LIMIT_EXCEEDED
SEC_SECRET_REDACTED
```

Opening a malicious package should result in a safe diagnostic, not a crash or
partial render. After a transaction-integrity failure, writes remain disabled
until recovery succeeds.

## 16. Security test plan

- Path traversal and symlink/junction race corpus on supported platforms.
- Malformed JSON, depth, count, large Unicode, and decompression-bomb fixtures
  when packed encoding is introduced.
- OWASP-style XSS corpus across HTML, links, marks, SVG, CSS, and media types.
- Cross-origin and CSRF attacks against the loopback API.
- Prompt-injection fixtures attempting tool escalation, decision forgery, and
  secret extraction.
- Stale-snapshot races during comment, proposal, and acceptance writes.
- Provider error/log redaction tests with synthetic secrets.
- Dependency and plugin permission review in release CI.

## 17. Deferred security capabilities

- Cryptographic package signing and transparency logs.
- Remote user authentication and fine-grained authorization.
- Encrypted comments or per-audience content.
- Sandboxed third-party profile execution.
- Secure remote collaboration and real-time synchronization.
- Supply-chain policy for a public profile/plugin registry.
