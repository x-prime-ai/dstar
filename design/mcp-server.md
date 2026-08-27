# MCP Server Design

Status: **Draft**

## 1. Boundary

The MCP server is a thin, non-normative adapter over `@dstar/core` and
`@dstar/node`. It exposes one fixed document or genesis draft to any compatible
MCP client. DSTAR does not know whether the client is interactive software,
automation, or another runtime.

The launcher fixes:

- document package or genesis draft;
- authenticated human principal;
- expiry and byte/call budgets; and
- filesystem/runtime handles unavailable to tool arguments.

The principal is the person on whose authority the client is operating. MCP
does not serialize an executor identity, runtime session, model, provider,
delegation, or task into the package.

## 2. Authority

MCP tools may:

- read the fixed document, annotations, sources, and mappings;
- simulate update operations;
- append a reply attributed to the fixed human principal;
- store a pending update proposal attributed to that principal; and
- stage a pending genesis proposal for that principal's fixed draft.

MCP exposes no tool for accepting, rejecting, superseding, resolving, changing
identity, opening another package, arbitrary paths, shell execution, or
unrestricted network access. Proposal submission never changes canonical
content.

## 3. Process modes

```text
dstar mcp document <document.dstar> --principal <human-id>
dstar mcp genesis <draft> --principal <human-id>
```

The first transport is stdio. Standard output contains only MCP messages;
redacted diagnostics use standard error.

The process capability is server-held and never crosses MCP. There is no
`taskToken`, `start_task`, executor assignment, or task lifecycle. Calls consume
the process-level budget directly.

## 4. Tools

| Tool | Mode | Effect |
| --- | --- | --- |
| `get_manifest` | both | Current manifest or fixed genesis request |
| `list_comments` | document | Comment summaries, optionally assigned to the principal |
| `get_node` | document | Canonical node, ancestors, and bounded neighbors |
| `search_document` | document | Deterministic local text search |
| `get_annotation` | document | One portable annotation thread |
| `get_source` | both | Source metadata without implicit fetching |
| `simulate_update` | document | Pure validation, applicability, and semantic diff |
| `submit_proposal` | document | Persist one pending update proposal |
| `reply_comment` | document | Append one reply under the principal |
| `submit_genesis` | genesis | Stage one pending genesis proposal |

Every update simulation/submission supplies explicit `baseChange` and
`baseRevision`. Removing task state must not allow the server to silently move
a proposal to a head that the client did not inspect. A stale proposal may be
retained for review; it is never silently rebased or accepted.

Terminal writes are idempotent by principal plus caller-supplied idempotency
key. Repeating the same command returns the original portable result when it is
still current; reusing a key with different arguments fails.

## 5. Resources

Resources are optional URI-addressed views of the same fixed scope:

| URI | Contents |
| --- | --- |
| `dstar://document/manifest` | Current manifest |
| `dstar://document/node/{nodeId}` | Canonical node context |
| `dstar://annotation/{annotationId}` | Annotation thread |
| `dstar://source/{sourceId}` | Source metadata |
| `dstar://projection/{projectionId}/mapping` | Projection mapping |
| `dstar://genesis/request` | Fixed genesis request |

Resources grant no additional mutation authority. Clients without Resource
support use equivalent read tools. Change notifications are best-effort
invalidation hints; every read reopens a validated snapshot.

## 6. MCP App

The optional MCP App packages the same renderer and review controller used by
the standalone UI. Its tool calls still pass through host policy and the DSTAR
server. Embedding the UI does not expose hidden human-decision commands.

## 7. Compatibility

Raw tool names use ASCII letters, digits, and underscores. Adapter input schemas
are small and flattened without `$ref`, `oneOf`, or `allOf`. Results include
compact JSON text and may repeat the object as `structuredContent`.

The adapter is tool-complete; Resources and Apps degrade explicitly. The
normative DSTAR schemas remain independent of MCP schema limitations.

## 8. Security and errors

All tool arguments and document data are untrusted. The adapter validates IDs,
limits, bases, operations, profile rules, and package state. Errors return
stable safe codes and omit package paths, secrets, and document bodies.

Tool descriptions and annotations are presentation hints, not authorization.
Authorization comes only from the server-held process scope and the absence of
decision methods from this adapter.

## 9. Verification

Tests cover:

- MCP negotiation, stdio lifecycle, and stable public tool names;
- fixed document/draft isolation and principal immutability;
- no task/delegation/token surface;
- direct comment read/reply and proposal submission;
- explicit base handling, stale proposals, and idempotent retries;
- inability to discover or invoke human-decision methods;
- resource list/read/subscription and tool-only fallback; and
- protocol-only stdout plus redacted diagnostics.

A release test submits an update through a generic MCP client and verifies that
canonical revision and head remain unchanged until a separate interactive human
decision accepts the proposal.
