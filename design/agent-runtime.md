# Agent Runtime

Status: **Draft**

## 1. Purpose and authority

The agent runtime turns human intent into agent-authored DSTAR proposals or
replies. It is a Change Producer and delegation executor, not a Change Applier.
It may create canonical content proposals but can never accept them.

The runtime has two entry paths:

- **Genesis** starts from a human request and optional evidence before a
  completed package exists.
- **Delegation** starts from an existing annotation with a portable target.

Provider models, prompts, planning loops, and local job records are replaceable
implementation details. The resulting agent actor, proposal, reply, sources,
and delegation result are portable package state.

## 2. Job model

Local execution uses a durable runtime job:

```ts
type AgentJobStatus =
  | "queued"
  | "preparing_context"
  | "running"
  | "validating_output"
  | "persisting_result"
  | "succeeded"
  | "failed"
  | "cancelled";

interface AgentJob {
  id: JobId;
  kind: "genesis" | "delegation" | "rebase";
  packageRuntimeKey?: string;
  portableDelegationId?: DelegationId;
  startingSnapshotId?: SnapshotId;
  agent: AgentActor;
  provider: ProviderRef;
  status: AgentJobStatus;
  attempts: AgentAttempt[];
}
```

This job lifecycle is not serialized into DSTAR. For delegation work, the
runtime mirrors meaningful execution boundaries to the portable delegation:

```text
local queued             -> delegation queued
first provider/tool work -> delegation in_progress
portable result stored   -> delegation completed
terminal execution error -> delegation failed
human cancellation       -> delegation cancelled
```

The portable terminal transition and result write occur in one package
transaction. Local retries do not create multiple delegations or proposals.

## 3. Agent identity

Every configured agent has a stable application-level actor ID independent of
a specific provider request. An actor may include model and provider metadata,
but those fields describe the producer and do not determine authorization.

The runtime verifies that:

- delegation `assignee` equals the executing agent actor;
- produced changes use that agent as `author`;
- produced replies use that agent as `author`;
- genesis proposals identify the configured genesis agent; and
- provider responses cannot override the actor supplied by the runtime.

Model upgrades may retain an actor ID only when the configured logical agent is
intended to remain the same. Provider request IDs and hidden reasoning are local
metadata, not portable actor IDs.

## 4. Provider port

```ts
interface AgentProvider {
  capabilities(): ProviderCapabilities;
  run(input: ProviderRunInput, signal: AbortSignal): Promise<ProviderRunResult>;
}

interface ProviderRunInput {
  systemPolicy: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  responseSchema?: JsonSchema;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    maxToolCalls: number;
    timeoutMs: number;
  };
}
```

Adapters normalize structured output, tool calling, cancellation, usage, and
retryable errors. Core services do not branch on provider-specific message or
tool formats.

Provider selection is local configuration. A `.dstar` package may name an
intended agent actor but does not carry API keys, endpoints, or executable
provider configuration.

## 5. Context assembly

The runtime uses semantic targeting rather than sending the entire package by
default.

### 5.1 Delegation context

Context assembly starts with the source annotation and includes:

1. delegation instruction and lifecycle metadata;
2. annotation body, replies visible to agents, and primary target;
3. copied canonical targets and their current resolution state;
4. exact target nodes or ranges at the task's starting revision;
5. ancestor headings and the smallest container needed for meaning;
6. a bounded number of adjacent siblings for local coherence;
7. source records explicitly referenced by the annotation or nearby content;
8. declared profiles and relevant node/operation schema fragments;
9. manifest revision and head change; and
10. proposal requirements and authority policy.

When a target is ambiguous, orphaned, or missing, the runtime does not ask the
model to guess. It supplies the original quotation and asks for a reply or a
request for human clarification.

### 5.2 Context expansion

The initial context is deliberately small. Read-only tools allow expansion by
stable ID. Each expansion is logged and subject to audience metadata, package
limits, and the job token budget.

The model never receives comments excluded from the `agent` audience. The
runtime also omits unrelated secrets, runtime logs, rejected drafts, and local
UI state.

### 5.3 Context budget policy

Default allocation:

- 20% task, annotation, and authority instructions;
- 50% canonical content and ancestors;
- 20% sources and related discussion; and
- 10% reserved for tool results and repair feedback.

When content exceeds the limit, the runtime truncates by semantic units and
lists omitted node/source IDs. It never silently truncates within a JSON object
or presents a partial node as complete.

## 6. Tool boundary

Agents receive logical DSTAR tools, not shell, arbitrary network, or raw file
access.

### Read tools

```text
get_manifest()
get_node(node_id, include_children?, depth?)
get_parent_context(node_id)
get_annotation(annotation_id)
get_projection_mapping(projection_id, segment_ids)
get_source(source_id)
get_asset_metadata(path)
search_document(query, limit)
```

`get_source` returns package metadata and stored source content when available.
Fetching an external URL is a separately authorized capability and is disabled
by default.

### Output tools

```text
propose_genesis(document, sources)
propose_change(operations, motivated_by, fulfills, sources)
reply_to_annotation(annotation_id, body)
complete_without_result(reason)
```

The broker fills IDs, actor identity, timestamps, bases, and idempotency keys.
The model supplies semantic content and operation intent but cannot forge a
human request, decision actor, accepted status, or result revision.

Output calls stage results until the attempt ends; they do not write the package
immediately. One attempt may return at most one change and one reply, matching
the delegation's typed `results` array. The broker validates and persists the
staged result bundle with the terminal delegation transition.

## 7. Genesis flow

### 7.1 Draft input

A local `GenesisDraft` contains:

- human actor and request body;
- optional source records or files approved for use;
- desired title and declared profiles;
- output package location;
- selected agent actor/provider; and
- local creation and expiry metadata.

It lives outside a completed package. Source files are copied into a bounded
draft workspace only after explicit selection; arbitrary directories are never
implicitly exposed.

### 7.2 Generation

The genesis agent receives the request, evidence, supported profile schemas,
and a requirement to produce stable opaque IDs. The broker validates:

- exactly one `create_document` operation;
- agent authorship and human request provenance;
- profile membership and containment;
- node ID uniqueness;
- package-relative asset references;
- source reference integrity; and
- canonical revision calculation.

Asset generation is a separate broker capability. Generated assets are staged
with media type, size, and safe package path before preview.

### 7.3 Preview and decision

The runtime renders the proposed root in an isolated preview. The human may:

- accept, materializing the completed package;
- reject, retaining or deleting the local draft; or
- provide further direction, which creates a new genesis proposal rather than
  mutating the previous proposal payload.

Only accepted genesis is portable in 0.1.

## 8. Delegation execution

1. Verify the delegation is `queued`, assigned to the configured agent, and
   references a valid open or resolved annotation.
2. Acquire a short package write lock and transition it to `in_progress`.
3. Open and retain the resulting starting snapshot.
4. Resolve primary and canonical targets without guessing.
5. Assemble bounded context and run the provider/tool loop.
6. Validate the terminal output against the current package.
7. Persist a proposed change or agent reply.
8. In the same transaction, append the typed delegation result and terminal
   metadata.
9. Leave the annotation lifecycle unchanged.

A resolved annotation may still be delegated intentionally, but the UI warns
the human before creating that delegation.

## 9. Proposal construction

The broker, not the model, supplies:

- change and operation IDs;
- `kind`, `author`, `createdAt`, and `idempotencyKey`;
- the job's starting-snapshot `baseChange` and `baseRevision`;
- `motivatedBy` and `fulfills` links from the task;
- target and parent hashes computed from the operation working-copy state; and
- source IDs already present or staged in the candidate mutation.

The model chooses operation types, semantic targets, destinations, replacement
content, and source use. The broker never advances bases to a head the agent did
not inspect; a rebase job starts a new snapshot and new attempt. Before
persistence the runtime simulates ordered
operations and rejects output that is structurally invalid, ambiguous, outside
supported profiles, or broader than the requested task without explanation.

The proposal always begins as `proposed`. The runtime cannot call the human
decision path on behalf of the agent.

## 10. Output validation and repair

Validation failures are divided into:

- **repairable shape errors** — malformed tool arguments, missing required
  fields supplied by the model, or unsupported operation choice;
- **semantic task errors** — target missing, profile violation, conflicting
  instruction, or unsupported content; and
- **runtime errors** — provider outage, timeout, cancellation, or local storage
  failure.

One bounded repair attempt may return machine-readable diagnostics to the same
agent attempt. Repair creates no portable object until it validates. The runtime
does not repair semantic content itself or silently substitute a different
target.

After the repair limit:

- a useful explanation becomes an agent reply when safe;
- otherwise the delegation becomes `failed` with a non-sensitive reason; and
- provider diagnostics remain local.

## 11. Rebase requests

A stale proposal is never edited in place. `request-rebase` creates a new
delegation-like local job with:

- the original immutable proposal;
- current head and revision;
- current resolution of all targets;
- simulation diagnostics; and
- the human request to preserve or reconsider intent.

The agent must emit a new change ID with current bases and may change operations
when context changed. The original proposal may later be marked `superseded` by
a separate human decision; creating the replacement does not do so implicitly.

## 12. Cancellation, retries, and idempotency

- Cancellation stops provider work and tool calls through `AbortSignal`.
- A cancelled delegation is terminal and cannot be resumed; reassignment gets a
  new delegation ID.
- Transient provider failures may retry within one local job using exponential
  backoff and provider idempotency when available.
- The terminal portable result is written once using a runtime idempotency key
  keyed by delegation ID and attempt generation.
- If the process crashes after writing a proposal but before updating the
  delegation, recovery finds the authored proposal by its recorded local result
  ID and completes the same transaction or reports manual recovery.

## 13. Prompt-injection boundary

Canonical content, comments, sources, projection text, and external pages are
untrusted data. The system policy and tool broker remain authoritative.

The runtime:

- labels each context block with its source and trust class;
- never concatenates source text into system instructions;
- does not expose decision or filesystem-write tools;
- validates every tool call independently of model prose;
- requires explicit user authorization before external fetches;
- limits recursive tool expansion and output size; and
- records source use without treating source instructions as policy.

## 14. Provider and model configuration

Configuration contains:

- logical agent actor ID and display name;
- provider adapter and model identifier;
- supported structured-output and tool capabilities;
- token, time, tool-call, and cost limits;
- external-network policy;
- retry policy; and
- context policy version.

Configuration is local and may be shared by application settings, but package
portability cannot depend on the same model remaining available.

## 15. Tests

- Provider-contract tests with deterministic fake agents.
- Context fixtures proving unrelated and audience-excluded data is absent.
- Genesis golden tests from request to proposed root and acceptance preview.
- Delegation lifecycle tests for change, reply, failure, and cancellation.
- Malicious tool arguments and forged actor/status tests.
- Stale-snapshot tests during inference and before persistence.
- Repair-loop budget and duplicate-result tests.
- Prompt-injection fixtures in comments, source files, and canonical content.
- Cross-provider tests requiring equivalent valid DSTAR output, not identical
  prose.
