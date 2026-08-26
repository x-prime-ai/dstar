# MCP Server Design

Status: **Draft**

## 1. Purpose and boundary

The MCP server lets an MCP-capable agent inspect one DSTAR document and return
review work through a standard tool interface. It is an adapter over the same
workspace, review, evidence, and agent services used by the CLI and review
client. It does not implement a second document model, open package files
directly, or define portable behavior.

The server is intentionally capability-restricted:

- resources expose bounded, read-only context;
- tools may search, validate draft output, reply to an assigned annotation, or
  submit a proposal;
- every read is filtered by the session actor and audience policy;
- every write is bound to the package snapshot and active task; and
- no agent-facing MCP session can accept, reject, supersede, resolve, or commit
  canonical content.

Human decisions continue through the review client or explicit human CLI/API
commands. MCP is not an authority shortcut.

## 2. Protocol compatibility

The implementation follows the negotiated MCP protocol version rather than
assuming that the newest specification is always available. On initialization
it advertises only capabilities implemented for that session.

The 0.1 server advertises:

- `resources`, without subscriptions or list-change notifications initially;
- `tools`, with a stable list for the lifetime of the session; and
- no server prompts, sampling, elicitation, or task-augmented execution.

Tool inputs and structured results have explicit JSON Schemas. Unknown fields
are rejected unless a tool schema deliberately permits them. Protocol framing,
lifecycle, cancellation, and error behavior are delegated to a maintained MCP
SDK behind a small adapter and covered by compatibility tests.

References for the transport adapter are the current official MCP
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources),
[transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
and
[authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
specifications. These links guide this implementation, not the DSTAR protocol.

## 3. Process and transport model

### 3.1 Standard input/output in 0.1

The initial server is launched as a subprocess:

```text
dstar mcp <document.dstar> --actor <agent-id> --task <delegation-id>
```

The host supplies opaque session configuration through inherited process state
or environment variables. The subprocess receives exactly one of:

- an existing package plus one active delegation; or
- a new genesis draft plus one creation request.

It cannot choose another package, traverse arbitrary roots, or change actor or
task after initialization. Standard output contains only MCP protocol messages;
diagnostics go to standard error with document bodies and secrets redacted.

The workspace service may host the adapter in-process, but the observable
authorization and tool contracts are identical.

### 3.2 Future Streamable HTTP transport

Streamable HTTP is deferred. If added, it must:

- bind to loopback by default;
- validate `Origin` on every applicable request;
- authenticate every session and request under the MCP authorization rules;
- bind package, actor, audience, and task scope server-side rather than trusting
  request arguments; and
- use the local-service CSRF, rate-limit, body-limit, and shutdown controls.

A public or multi-user MCP endpoint requires a separate authorization design.

## 4. Session capability

The launcher creates an unforgeable `McpSessionCapability`:

```ts
interface McpSessionCapability {
  sessionId: string;
  mode: "delegation" | "genesis";
  packageHandle?: PackageHandle;
  draftHandle?: GenesisDraftHandle;
  actorId: string;
  delegationId?: string;
  allowedAnnotationIds: readonly string[];
  allowedSourceIds: readonly string[];
  startingSnapshotId?: string;
  expiresAt: string;
  budgets: {
    maxCalls: number;
    maxReadBytes: number;
    maxOutputBytes: number;
  };
}
```

The object never crosses the MCP boundary. Public tool arguments use semantic
IDs only; the adapter combines them with the server-held capability. Each call
checks expiry, cancellation, budget, task state, and current package identity.

## 5. Resources

Resources are application-driven context, not a dump of the package. The
server lists only objects visible to the scoped actor.

| URI | Contents |
| --- | --- |
| `dstar://document/manifest` | Safe manifest summary, head revision, profile IDs, snapshot ID |
| `dstar://document/node/{nodeId}` | One canonical node and bounded semantic neighborhood |
| `dstar://annotation/{annotationId}` | Assigned thread and visible replies |
| `dstar://source/{sourceId}` | Registered source metadata and an authorized bounded extract |
| `dstar://projection/{projectionId}/mapping` | Projection metadata and relevant mapping records |
| `dstar://task/current` | Active delegation or genesis request, status, and budgets |

Resource templates validate DSTAR IDs before lookup. A missing, disallowed, or
audience-excluded object is reported as unavailable without revealing whether a
hidden object exists. Binary assets are not returned inline in 0.1; an explicit
brokered extraction tool may be added after media limits and provider support
are designed.

Resource contents include `snapshotId` where applicable. Reading a resource
does not silently advance the task's starting snapshot.

## 6. Agent tools

### 6.1 Read and analysis tools

| Tool | Result |
| --- | --- |
| `dstar.get_manifest` | Bounded manifest and capability summary |
| `dstar.get_node` | Node, ancestors, and bounded neighbors |
| `dstar.search_document` | Ranked node IDs and short excerpts within the package |
| `dstar.get_annotation` | One permitted thread with resolution state |
| `dstar.get_source` | Permitted source metadata and bounded extract |
| `dstar.simulate_update` | Validation, applicability, and semantic diff for draft operations |

Search is local and deterministic for a snapshot. It accepts limits and profile
filters, not filesystem paths or arbitrary query code. Source reads never fetch
a URL implicitly; external retrieval is a separately brokered capability.

### 6.2 Output tools

| Mode | Tool | Effect |
| --- | --- | --- |
| Delegation | `dstar.submit_result` | Atomically stage at most one proposed update and at most one annotation reply, or a no-result outcome |
| Genesis | `dstar.submit_genesis` | Stage one initial document proposal and allowed initial assets in the draft workspace |

There is one terminal submission tool per mode so a proposal and its explanatory
reply cannot be partially persisted. The broker, not the model, supplies:

- proposal, reply, and actor IDs;
- author identity and timestamps;
- delegation linkage;
- starting snapshot and base revisions;
- initial lifecycle status; and
- output hashes and provenance envelope.

The model supplies semantic content, operations, explicit preconditions,
explanation, and cited source IDs. The broker validates the result, simulates
all operations, and persists it as a proposal even when the starting snapshot
has become stale. It never applies the proposal.

Terminal submission is idempotent per task and client request key. A second
non-identical terminal result is rejected; retrying the identical result returns
the previously created IDs.

## 7. Tools deliberately absent

The agent-facing server does not expose tools for:

- accepting, rejecting, or superseding a change;
- resolving or deleting a human comment;
- creating or assigning a delegation;
- changing audience or actor identity;
- modifying arbitrary package files, projections, assets, or sources;
- installing a profile, renderer, plugin, or provider; or
- executing shell commands or unrestricted network requests.

Some actions may exist in human interfaces, but sharing their service code does
not make them part of the MCP capability.

## 8. Errors and cancellation

Malformed MCP messages and unknown methods use protocol errors. Valid tool
calls that fail DSTAR validation return tool execution errors with stable DSTAR
diagnostic codes and safe structured details, for example:

```json
{
  "code": "CHANGE_BASE_STALE",
  "retryable": true,
  "snapshotId": "snapshot:current",
  "guidance": "Inspect the current nodes and submit a replacement proposal."
}
```

Errors do not include hidden content, absolute paths, secrets, or raw provider
exceptions. Cancellation stops pending reads or simulation when possible and
prevents terminal submission once the owning job is cancelled. Package mutation
still follows the package transaction rules if cancellation races with commit.

## 9. Security and observability

All MCP inputs and model-visible data are untrusted. The adapter:

- validates tool arguments and structured outputs;
- applies call, byte, time, token, and concurrency limits;
- sanitizes resource text and tool diagnostics;
- labels canonical content, comments, and sources as data rather than system
  instructions when assembling provider context;
- refuses IDs outside the capability before object lookup;
- never returns provider credentials, local API tokens, or absolute paths; and
- logs session ID, tool name, outcome, duration, and byte counts without bodies.

Tool descriptions and annotations are convenience metadata, not authorization.
Authorization is determined only by the server-held session capability.

## 10. Verification

Tests cover:

- MCP initialization and capability negotiation across supported protocol
  versions;
- resource listing/reading and template validation;
- tool input/output-schema conformance;
- audience and task-scope non-disclosure;
- path, ID, oversized payload, prompt-injection, and forged-actor attempts;
- inability to discover or invoke any human-decision operation;
- stale snapshot, cancellation, retry, and duplicate terminal submission;
- protocol-only stdout and redacted stderr; and
- behavioral equivalence between MCP submissions and direct agent-runtime
  submissions through the same broker.

A release test launches the server under a generic MCP client, completes a
deterministic fake-agent delegation, and verifies that the result is a pending
proposal until a separate authenticated human action accepts it.
