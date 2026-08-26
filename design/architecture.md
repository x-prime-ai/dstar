# Reference Architecture

Status: **Draft**

## 1. Purpose

This document defines the architecture of the first DSTAR implementation. It
turns the protocol roles into buildable components while preserving three hard
boundaries:

1. `document.json` is the only canonical content source.
2. Agents author every canonical change; humans create direction and decisions.
3. Portable package state remains usable without the reference application.

The first product is a local workspace application for opening a `.dstar`
directory, reading rich views, commenting, delegating work, reviewing agent
proposals, and accepting or rejecting them.

## 2. Goals and non-goals

### Goals

- Implement the complete DSTAR 0.1 north-star workflow.
- Keep protocol logic independently reusable by other applications.
- Make every package write validated, recoverable, and attributable.
- Give the browser enough semantic mapping to create portable selectors.
- Let different agent providers produce the same structured DSTAR changes.
- Detect stale or conflicting work before canonical content is mutated.
- Regenerate views without silently relocating review state.

### Non-goals for the first implementation

- Hosted accounts, organizations, billing, or remote authorization.
- Real-time multi-user synchronization or CRDTs.
- Direct human editing of canonical content.
- Arbitrary script execution from packages or projections.
- A general agent framework or autonomous background knowledge system.
- Tiptap/ProseMirror document JSON as an alternate source of truth.
- Full support for every reserved base node before its spec rules exist.

## 3. Architectural style

The implementation uses ports and adapters. Protocol behavior lives in pure
packages; filesystem, HTTP, UI, renderers, and model providers depend inward on
those packages.

```text
Browser review app
       |
       | localhost HTTP + event stream
       v
Workspace service / CLI
       |
       +-- MCP adapter -----------> scoped resources + agent tools
       +-- Review service ---------> Target resolver
       +-- Delegation service -----> Agent runtime -> Provider adapter
       +-- Change service ---------> Change applier
       +-- Render service ---------> Profile/render adapters
       |
       v
Package repository -> Validator -> Pure DSTAR core
       |
       +-- portable .dstar package
       +-- non-portable local runtime store
```

No browser or agent process receives unrestricted filesystem access. Both act
through application services that enforce package and authority rules.

## 4. Deployment and process model

### 4.1 Local workspace service

`dstar serve <document.dstar>` starts a loopback-only service and opens the
review client. The service:

- owns the package lock while performing a write;
- watches package files for out-of-band changes;
- exposes document snapshots and explicit commands over a versioned local API;
- runs validation, rendering, change simulation, and agent jobs; and
- streams snapshot/job invalidations to the browser.

The service binds to `127.0.0.1` by default, uses a random port and per-session
bearer token, and rejects non-loopback origins. There is no public server mode
in 0.1.

### 4.2 CLI

The CLI calls the same application services in-process. Initial commands are:

```text
dstar validate <package>
dstar inspect <package>
dstar history <package>
dstar show <package> --version <accepted-change-id>
dstar serve <package>
dstar genesis <request-file> --output <name.dstar>
dstar render <package> [--projection <id>]
dstar accept <package> <change-id>
dstar reject <package> <change-id> --reason <text>
```

Commands that make a human decision require an explicit actor ID and an
interactive confirmation unless `--yes` is passed in an already authenticated
local session.

### 4.3 Browser review app

The browser app is a stateless projection of service snapshots plus ephemeral
UI state. It never writes package files itself. Refreshing the page reconstructs
all durable document, comment, delegation, proposal, and decision state from
the package.

### 4.4 Agent workers

Agent execution occurs in service-owned jobs. The agent receives a bounded tool
surface rather than package paths. A provider SDK may run in-process initially;
the port permits moving it to an isolated process later without changing core
contracts.

### 4.5 MCP server

`dstar mcp` exposes one package/task-scoped agent session over standard
input/output. It adapts the workspace and agent services; it does not read files
or make human decisions itself. Read-only resources provide bounded context and
tools may submit a proposal or reply, but never accept, reject, supersede,
resolve, or otherwise cross the human authority boundary.

The initial transport is standard input/output. Streamable HTTP is deferred and
would require the local-service and MCP authorization controls described in
[MCP server](mcp-server.md).

## 5. Components

### 5.1 Protocol core

Pure TypeScript with no Node-specific imports. Responsibilities:

- protocol types and branded IDs;
- RFC 8785 canonicalization and revisions;
- tree indexing and Unicode-code-point text streams;
- selector construction and resolution;
- operation simulation;
- structural and cross-object validation;
- stable diagnostic codes; and
- profile registration contracts.

The core accepts values and byte arrays. It does not open files, fetch URLs,
render React, invoke models, or make authorization decisions.

### 5.2 Package repository

The only component allowed to map DSTAR objects to filesystem paths. It opens a
package as an immutable `PackageSnapshot`, validates paths and symlinks, and
commits `PackageMutation` objects through a lock and recovery journal.

Detailed behavior is in [Package runtime](package-runtime.md).

### 5.3 Validator

Validation has explicit phases:

1. safe filesystem inventory;
2. JSON parsing and I-JSON checks;
3. JSON Schema validation;
4. profile-aware document validation;
5. cross-object reference and authority validation;
6. revision and accepted-chain validation; and
7. role-specific behavioral checks when requested.

Each diagnostic has a stable code, severity, object/path location, summary, and
structured details. Validation never repairs package data implicitly.

### 5.4 Review service

Creates and updates annotations and delegations, resolves targets against the
current snapshot, and prepares review-oriented read models. It enforces that UI
selection creates protocol anchors before accepting a comment command.

### 5.5 Render service

Produces the in-memory canonical view and stored projections. It combines the
canonical tree with profile renderers, assets, and a theme, then emits explicit
node or segment mappings. Unsupported content is visible and preserved.

### 5.6 MCP adapter

Translates negotiated MCP resources and tool calls into existing workspace
service commands. A server-held session capability fixes the document or
genesis draft, actor, task, audience, starting snapshot, expiry, and budgets.
Model arguments cannot expand that capability.

The adapter exposes no package repository or decision-service handle. Its
terminal output call delegates validation, simulation, provenance completion,
and atomic persistence to the agent runtime. See [MCP server](mcp-server.md).

### 5.7 Agent runtime

Builds least-context task packages, exposes read/proposal tools, invokes a
provider adapter, validates structured outputs, and records typed delegation
results. It cannot accept a change.

### 5.8 Change service, version materializer, and applier

Simulates proposals, produces review diffs, checks authority and preconditions,
commits human decisions, and materializes historical canonical versions from
the accepted chain. Acceptance and historical replay share the same
deterministic operation engine so their semantics cannot drift. Neither has a
model dependency.

### 5.9 Evidence and asset service

Registers human-supplied URL, file, and citation sources; stages genesis assets;
and serves validated source/asset bytes through opaque local URLs. Update-time
asset mutation remains disabled until the protocol defines it.

Detailed behavior is in [Evidence and assets](evidence-assets.md).

### 5.10 Local runtime store

Non-portable state is stored outside the `.dstar` directory under the OS
application data directory. It includes:

- package locks and transaction journals;
- agent job attempts and provider request IDs;
- idempotency execution ledger;
- render and validation caches;
- local logs and metrics; and
- UI preferences and session tokens.

Provider secrets are stored in the OS keychain or process environment, never in
the package or runtime logs.

## 6. State ownership

| State | Authority | Durable location |
| --- | --- | --- |
| Canonical content | DSTAR package | `document.json` |
| Current revision/head | DSTAR package | `manifest.json` |
| Comments/replies | DSTAR package | `annotations/` |
| Assignments/results | DSTAR package | `delegations/` |
| Proposals/decisions | DSTAR package | `changes/` |
| Source metadata/assets | DSTAR package | `sources.json`, `assets/` |
| Projection artifacts/maps | DSTAR package | `projections/` |
| Locks, jobs, caches, secrets | Reference runtime | external runtime store |
| Browser selection/hover state | Browser | memory only |

Portable state is never made dependent on a runtime database row. The runtime
may index package content, but package files win after validation.

## 7. Internal service contracts

Interfaces below define architectural seams, not the public protocol:

```ts
interface PackageRepository {
  open(path: AbsolutePath): Promise<PackageSnapshot>;
  commit(command: PackageCommit): Promise<PackageSnapshot>;
  watch(path: AbsolutePath, onChange: SnapshotListener): Disposable;
}

interface DstarValidator {
  validate(snapshot: PackageSnapshot, role?: ConformanceRole): Diagnostic[];
}

interface Renderer {
  renderCanonical(snapshot: PackageSnapshot): CanonicalViewModel;
  renderProjection(input: ProjectionRequest): Promise<ProjectionOutput>;
}

interface AgentRuntime {
  startGenesis(request: GenesisRequest): Promise<JobId>;
  startDelegation(packageId: PackageId, delegationId: DelegationId): Promise<JobId>;
}

interface ChangeApplier {
  simulate(snapshot: PackageSnapshot, changeId: ChangeId): SimulationResult;
  accept(command: AcceptChangeCommand): Promise<PackageCommit>;
  decide(command: RejectOrSupersedeCommand): Promise<PackageCommit>;
}

interface VersionMaterializer {
  list(snapshot: PackageSnapshot): readonly CanonicalVersionSummary[];
  materialize(
    snapshot: PackageSnapshot,
    targetChangeId: ChangeId,
  ): VersionMaterialization;
}
```

All mutating commands contain `expectedSnapshotId`. The service rejects a
command when the package changed after the UI loaded, even if the protocol-level
operation might later be rebasable.

## 8. Snapshot model

A `PackageSnapshot` is immutable and contains:

- a runtime-only snapshot ID derived from the validated inventory;
- parsed protocol objects and original bytes where lossless preservation matters;
- indexes by node, annotation, reply, delegation, change, projection, and source
  ID;
- the manifest revision and head change;
- validation diagnostics; and
- projection freshness and target-resolution read models.

Every request is evaluated against exactly one snapshot. Long-running agent
jobs retain and serialize their starting `baseChange` and `baseRevision`; they
may persist that proposal into a newer package snapshot, where it is visibly
stale rather than silently rebased.

## 9. End-to-end workflows

### 9.1 Genesis

```text
Human request + source references
    -> runtime draft (outside any completed package)
    -> agent tool calls produce create_document proposal
    -> schema/profile validation
    -> canonical preview + source/provenance review
    -> human accepts
    -> repository materializes package transaction
       document.json
       accepted genesis change
       manifest revision + headChange
    -> renderer creates initial projections
```

Rejecting a genesis draft leaves no completed `.dstar` package. Draft retention
is a local runtime preference because the spec does not yet define a portable
unaccepted-genesis envelope.

### 9.2 Comment and delegation

```text
Browser Range
    -> view adapter creates primary selector
    -> projection mapping creates canonical targets when needed
    -> review service validates quotation and revisions
    -> atomic annotation file write
    -> optional separate delegation command
    -> agent job queued
```

Comment creation returns before any agent runs. Delegation is never inferred
from `purpose: change-request`.

### 9.3 Agent proposal

```text
Queued delegation
    -> mark in_progress
    -> resolve annotation against starting snapshot
    -> build bounded context
    -> provider-neutral agent tools
    -> validate proposed operations and provenance
    -> write proposed change
    -> record typed delegation results + terminal status
    -> annotation remains open
```

If no valid proposal is possible, the agent creates a reply or completes with a
reason. It does not fabricate a no-op change to satisfy the job.

### 9.4 Human decision

```text
Proposed change
    -> deterministic simulation and semantic diff
    -> human accepts or rejects

accept:
    verify expected snapshot + human actor
    -> verify base/head and ordered preconditions
    -> apply to isolated working copy
    -> validate resulting document
    -> atomic package transaction
    -> invalidate render/target caches
    -> regenerate projections asynchronously

reject/supersede:
    -> atomic decision update only
```

The UI never presents a stale simulation as currently applicable. If the head
changed, it shows a stale-base result and offers a new agent task to rebase.

### 9.5 Projection regeneration

```text
Accepted canonical revision
    -> mark stored projections stale in read model
    -> renderer writes new artifacts/index transaction
    -> resolver compares old annotation mappings with new mappings
    -> exact/recovered targets display inline
    -> ambiguous/orphaned targets remain in review inbox
```

Regeneration does not rewrite existing annotations or their primary targets.

## 10. Local API

The workspace service exposes `/api/v1` commands. The exact HTTP encoding may
evolve, but boundaries are fixed:

### Reads

- `GET /snapshot` — manifest, diagnostics, capabilities, freshness.
- `GET /document` — canonical view model and target-resolution states.
- `GET /versions` — accepted canonical versions in genesis-to-head order.
- `GET /versions/:changeId/document` — read-only materialized canonical version.
- `GET /projections/:id` — safe artifact descriptor and mapping.
- `GET /annotations` — threads with computed current resolution.
- `GET /changes/:id/simulation` — deterministic diff/conflicts.
- `GET /jobs/:id` — local execution state.
- `GET /sources` — portable evidence registry and safe preview descriptors.

### Commands

- `POST /annotations`
- `POST /annotations/:id/replies`
- `POST /annotations/:id/resolve`
- `POST /delegations`
- `POST /delegations/:id/cancel`
- `POST /changes/:id/accept`
- `POST /changes/:id/reject`
- `POST /changes/:id/supersede`
- `POST /changes/:id/request-rebase`
- `POST /projections/:id/regenerate`
- `POST /sources/url`, `/sources/file`, or `/sources/citation`

Every command body includes `expectedSnapshotId`, actor identity, and an
idempotency key. Mutations return the new snapshot ID and changed object IDs.

## 11. Consistency and failure policy

- Reads may run concurrently against immutable snapshots.
- Only one package commit runs at a time per package.
- File watcher events during a commit are coalesced and attributed to that
  transaction.
- Unexpected external changes invalidate the snapshot and cancel pending write
  commands; running agent inference may finish, but its output is submitted as a
  stale proposal rather than applied.
- A failed renderer never blocks access to canonical content or decisions.
- A failed agent never changes canonical content.
- A failed acceptance transaction is recovered before the package is reopened.
- A failed historical materialization returns diagnostics and never falls back
  to unverified cached content or mutates the package.

## 12. Technology baseline

- TypeScript in strict mode.
- Node.js 22+ and `pnpm` workspaces.
- React for the browser review application.
- A small loopback HTTP server with server-sent events for invalidation; no
  WebSocket is required in 0.1.
- JSON Schema Draft 2020-12 validator with formats enabled.
- RFC 8785 implementation verified against published vectors.
- Provider SDKs isolated behind an `AgentProvider` port.
- No framework-specific AST or editor state in protocol packages.

The initial canonical renderer uses React/DOM directly. Tiptap is deferred
because the product has no direct editing surface; an eventual Tiptap adapter
must translate all selections to DSTAR selectors at its boundary.

## 13. Observability

Local structured events include correlation IDs but exclude document bodies by
default:

- package open/validation duration and diagnostic counts;
- render duration, unsupported nodes, and output size;
- target-resolution outcomes;
- agent job latency, token/cost metadata, tool names, and result type;
- change simulation outcome and conflict class; and
- transaction recovery events.

Metrics used for product success are opt-in and aggregated. Prompts, comments,
sources, and generated content are never sent as telemetry.

## 14. Design constraints that remain open

These block later capabilities but not the first vertical slice:

- portable identity lineage for split/merge transformations;
- real-time concurrent annotation editing;
- remote identity and authorization;
- deterministic packed `.dstar.zip` encoding;
- portable event-log history beyond current snapshots and accepted changes;
- profile discovery and distribution; and
- retention limits for old projection provenance.
