# Package Runtime

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## Boundary

The package runtime opens untrusted `.dstar` directories into immutable
snapshots and applies validated, recoverable mutations. It contains no model,
provider, executor registry, task scheduler, or portable workflow engine.

Opening a package performs a bounded inventory, rejects links and special
files, parses duplicate-key-aware JSON metadata, parses HTML and CSS with
resource limits, validates stable identity and references, computes the
canonical file-set revision, and verifies the accepted history chain.

## Snapshot

```ts
interface PackageSnapshot {
  root: AbsolutePath;
  snapshotId: SnapshotId;
  documentRevision: Revision;
  headChange: ChangeId;
  inventory: readonly InventoryEntry[];
  htmlIndex: HtmlIdentityIndex;
  diagnostics: readonly Diagnostic[];
  writable: boolean;
}
```

`snapshotId` hashes the complete safe inventory and is runtime-only. The
portable `documentRevision` binds the canonical HTML, styles, assets, and
declared viewer-runtime behavior. A comment or pending proposal may change the
snapshot without changing the document revision.

## File classes

Every package path belongs to one explicit class:

- canonical presentation: `document.html`, declared CSS, and referenced assets;
- collaboration: annotations and replies;
- history: changes, content-addressed objects, and checkpoints;
- evidence: source metadata and captured source files; or
- manifest and indexes.

The repository never grants a command arbitrary path-write authority. A
candidate command supplies a bounded logical file set that is independently
classified and validated.

## Commands and transactions

```ts
type TransactionType =
  | "genesis"
  | "annotation"
  | "evidence"
  | "proposal"
  | "decision"
  | "accept-change"
  | "checkpoint";
```

Proposal commands can record a candidate and its derived patches but cannot
advance the canonical head. Decision and accepted-change commands require human
authority at the command layer.

Every mutation carries an expected snapshot ID and idempotency key. Repeating
the same command returns its already-current result; reusing a key with
different arguments fails.

## Content-addressed objects and patches

Objects are named by digest and immutable. The same asset or replacement blob
is stored once even when referenced by many versions.

For each changed canonical file, history stores either:

- an exact-base textual or binary patch;
- a compressed replacement object; or
- a reference to an object that already exists.

The selector is an implementation optimization. A portable change records base
digest, result digest, encoding, and object path so any implementation can
materialize the same bytes. If a patch is not materially smaller than a
replacement object, the runtime stores the replacement.

Patch application requires an exact base digest and verifies the result digest.
Fuzzy application is forbidden.

## Checkpoints

A checkpoint is a compressed, complete canonical file set for one accepted
revision. It is a replay accelerator, not a new version or authority source.

The runtime may create one when any configured threshold is reached:

- accepted changes since the nearest checkpoint;
- accumulated patch bytes relative to materialized document size; or
- measured historical materialization latency.

Checkpoint creation verifies the accepted chain first, writes the compressed
candidate atomically, reopens it, and verifies its document revision. Removing
all checkpoints must not make accepted history unrecoverable.

## Atomicity and recovery

Writes take an external per-package lock, reopen the package, verify the
expected snapshot and file digests, validate an in-memory candidate, then
journal staged files and backups outside the package. The manifest is installed
last when acceptance advances canonical state.

Recovery completes a fully installed journal, recognizes a fully old state, or
restores every old file from verified backups. An unverifiable mixed state is
read-only and reports recovery-required diagnostics.

An accepted update transaction installs:

- the new current canonical files;
- new immutable objects required by history;
- the accepted change and human decision; and
- the manifest with matching revision and head.

## Runtime store and watching

The external runtime directory stores locks, journals, backups, idempotency
records, disposable parsed DOM indexes, semantic diffs, preview snapshots, and
redacted diagnostics. Portable files remain authoritative.

File-watch events trigger a fresh safe inventory. A valid out-of-band edit that
breaks the accepted revision chain puts the workspace into inspect-only mode;
the runtime never invents provenance for it.

## Tests

- package containment, links, special files, and bounded inventory;
- HTML/CSS parser limits and stable ID validation;
- canonical file-set revision vectors;
- object deduplication and exact-base patch replay;
- patch-versus-replacement threshold selection;
- checkpoint creation, deletion, and verified materialization;
- stale writers, idempotency mismatch, and crash injection;
- out-of-band edits and inspect-only transitions; and
- old-or-new atomic acceptance with no hybrid package state.
