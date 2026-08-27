# Reference Architecture

Status: **Draft**

## 1. Boundaries

The first implementation preserves three hard boundaries:

1. `document.json` is the only canonical content source.
2. Every canonical mutation crosses an immutable proposal plus explicit human
   decision boundary.
3. Portable state remains usable without the reference application or the
   software that originally invoked it.

DSTAR is caller-independent. SDK and MCP operations may be invoked by any
external application, but the protocol and runtime do not model that
application's executor, session, task, model, or provider.

## 2. Components

```text
Browser review app
       |
       v
Workspace service / CLI
       |
       +-- MCP adapter -----------> any compatible MCP client
       +-- Review service ---------> annotations + human assignment
       +-- Change service ---------> simulation + human decisions
       +-- Render service ---------> deterministic views
       |
       v
Package repository -> Validator -> Pure DSTAR core
       |
       +-- portable .dstar package
       +-- non-portable local runtime store
```

The pure core owns schemas, revisions, indexes, profiles, selectors, operations,
history, and diagnostics. It has no filesystem, UI, MCP, network, model, or
provider dependency.

The package repository is the only component mapping protocol objects to
filesystem paths. It opens immutable snapshots and commits logical mutations
through locks and recovery journals.

The review service creates annotations/replies, assigns an annotation to a
human, resolves targets, and commits explicit human lifecycle decisions.

The MCP adapter translates a fixed package/draft plus fixed human principal to
public SDK calls. It exposes proposal production but no decision service.

## 3. Processes

### Workspace service

`dstar serve <document.dstar>` starts a loopback-only service with a random
port, bearer token, CSRF protection, and origin checks. It watches package
files, exposes versioned snapshots/commands, and streams invalidations.

### CLI

The CLI calls the same SDK services in-process. Decision commands require an
interactive human confirmation and exact simulated result revision.

### MCP

```text
dstar mcp document <document.dstar> --principal <human-id>
dstar mcp genesis <draft> --principal <human-id>
```

The process scope fixes its target and principal. Tool arguments cannot change
either. There is no DSTAR task start or portable execution lifecycle.

## 4. State ownership

| State | Authority | Location |
| --- | --- | --- |
| Canonical content | DSTAR package | `document.json` |
| Revision/head | DSTAR package | `manifest.json` |
| Comments/replies/human assignment | DSTAR package | `annotations/` |
| Proposals/decisions | DSTAR package | `changes/` |
| Sources/assets | DSTAR package | `sources.json`, `assets/` |
| Projections/maps | DSTAR package | `projections/` |
| Locks, journals, idempotency, caches | Reference runtime | external runtime root |
| Authentication and caller execution | Integrating application | outside DSTAR |

Portable state is never dependent on a runtime database row. Reopening package
files rebuilds all authoritative indexes.

## 5. Service contracts

```ts
interface PackageRepository {
  open(path: AbsolutePath): Promise<PackageSnapshot>;
  commit(command: PackageCommit): Promise<PackageSnapshot>;
  watch(path: AbsolutePath, listener: SnapshotListener): Disposable;
}

interface DstarValidator {
  validate(snapshot: PackageSnapshot, role?: ConformanceRole): Diagnostic[];
}

interface ProposalService {
  simulate(snapshot: PackageSnapshot, proposal: DstarChange): SimulationResult;
  record(command: RecordProposalCommand): Promise<PackageSnapshot>;
}

interface ChangeApplier {
  accept(command: AcceptChangeCommand): Promise<PackageSnapshot>;
  reject(command: RejectChangeCommand): Promise<PackageSnapshot>;
  supersede(command: SupersedeChangeCommand): Promise<PackageSnapshot>;
}

interface VersionMaterializer {
  list(snapshot: PackageSnapshot): readonly CanonicalVersionSummary[];
  materialize(snapshot: PackageSnapshot, changeId: ChangeId): VersionMaterialization;
}
```

Every mutation contains an expected snapshot ID and idempotency key. Proposal
commands additionally retain explicit canonical base change and revision.

## 6. Snapshot model

A `PackageSnapshot` contains parsed immutable protocol objects, source bytes,
indexes, diagnostics, projection freshness, and a runtime-only inventory hash.
The snapshot ID changes for collaboration/projection changes even when the
canonical revision is unchanged.

Every read evaluates exactly one validated snapshot. A proposal submitted after
the package advances retains its declared bases and is visibly stale; no layer
silently rewrites it.

## 7. Workflows

### Genesis

```text
human request + sources
    -> local draft
    -> SDK/MCP client stages genesis proposal under that human principal
    -> deterministic validation and preview
    -> separate human acceptance
    -> atomic package materialization
```

### Comment and assignment

```text
browser Range
    -> semantic/projection selector
    -> validated annotation write
    -> optional human assignee
```

Assignment returns immediately and starts nothing. The assignee decides outside
DSTAR whether and how to use another application to read, reply, or propose.

### Proposal

```text
client reads manifest/comment/nodes
    -> submits explicit base + ordered operations
    -> core validates and simulates
    -> node runtime records pending proposal
    -> annotation remains open; canonical head is unchanged
```

### Human decision

```text
pending proposal
    -> deterministic simulation and semantic diff
    -> interactive human confirmation
    -> atomic accept/reject/supersede transaction
```

Only acceptance changes `document.json`, manifest revision, and head.

## 8. Local API

Reads include snapshot, document, versions, projections, annotations, changes,
simulations, and sources. Commands include annotation creation/reply/assignment/
resolution, proposal decisions, projection regeneration, and source
registration.

The local review API may expose human decision commands because it is an
authenticated human surface. The MCP adapter intentionally does not compose or
export those methods.

## 9. Consistency and failures

- Reads use immutable snapshots; one package commit runs at a time.
- Writes reopen and compare the expected snapshot after acquiring the lock.
- Unexpected external changes invalidate pending commands.
- Renderer failure never blocks canonical access or decisions.
- MCP/client disconnect never changes canonical content.
- Acceptance crashes recover before package reopen.
- Historical materialization never falls back to unverified cache content.

## 10. Security and observability

The workspace service is loopback-only. Package paths, JSON, HTML, assets,
sources, and MCP arguments are untrusted and bounded. Proposal surfaces expose
no decision handle. External caller identity cannot be supplied through
model-controlled tool arguments; the launcher fixes the human principal.

Logs record correlation ID, operation name, outcome, duration, byte counts, and
diagnostic codes without document bodies. External applications own any richer
execution telemetry outside DSTAR.

## 11. Open design work

- portable split/merge identity lineage;
- real-time concurrent annotation editing;
- remote identity and authorization;
- deterministic packed `.dstar.zip`;
- portable event-log history for assignment/reassignment;
- profile discovery and distribution; and
- retention rules for old projection provenance.
