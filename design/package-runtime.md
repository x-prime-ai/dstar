# Package Runtime

Status: **Draft**

## Boundary

`@dstar/node` is the filesystem boundary around the pure `@dstar/core`. It
opens untrusted package trees into immutable snapshots and applies validated,
recoverable mutations. It contains no model/provider integration, executor
registry, task scheduler, or portable workflow engine.

Opening a package performs a bounded inventory, rejects links and special
files, parses duplicate-key-aware I-JSON, validates schemas and profiles,
checks references and revisions, and validates the accepted history chain.
Unknown optional profile content remains inspectable but makes mutation
read-only when safe semantics are unavailable.

## Snapshot

```ts
interface PackageSnapshot extends InMemoryPackage {
  root: string;
  snapshotId: SnapshotId;
  inventory: readonly InventoryEntry[];
  diagnostics: readonly Diagnostic[];
  writable: boolean;
}
```

`snapshotId` hashes the complete safe inventory and is runtime-only. Manifest
`revision` and `headChange` remain the portable canonical state. A comment,
proposal, projection, or asset write may change the snapshot without changing
the canonical revision.

## Commands and transactions

Public commands express logical mutations rather than arbitrary paths. The
repository independently restricts each transaction type:

```ts
type TransactionType =
  | "genesis" | "annotation" | "evidence" | "proposal"
  | "decision" | "accept-change" | "projection";
```

Annotation commands create threads, append direct human replies, resolve, or
set an optional human assignee. Proposal commands may add a proposed update or
reply but cannot write the canonical document or manifest head. Decision and
accepted-change commands require human authority at the command layer.

Every mutation carries an expected snapshot ID and idempotency key. Repeating
the same command returns its already-current result; reusing a key with
different arguments fails. Callers that need stable retry after later package
advancement use deterministic portable IDs and compare existing objects.

## Atomicity and recovery

Writes take an external per-package lock, reopen the package, verify snapshot
and file hashes, validate an in-memory candidate, then journal staged files and
backups outside the package. Targets are installed with the manifest last for
canonical acceptance. The package is reopened and validated before the new
snapshot is published.

Recovery completes a fully installed journal, recognizes a fully old state, or
restores every old file from verified backups. An unverifiable mixed state is
read-only and reports recovery-required diagnostics.

An accepted update transaction contains exactly the new document, the accepted
change, and the matching manifest. Projection regeneration is a separate
transaction and stale projections remain explicitly stale.

## Runtime store and watching

The external runtime directory stores locks, journals, backups, idempotency
records, disposable caches, and redacted diagnostics. Portable objects remain
authoritative files and reopening can rebuild all indexes.

File-watch events trigger a fresh safe inventory; event paths are never trusted.
A valid external edit creates a new snapshot. Invalid or provenance-breaking
edits put the workspace into inspect-only mode. The runtime never watches or
serves paths reached through links.

## Tests

- valid/invalid package inventories and root containment;
- bounded parsing and profile capability behavior;
- stale/concurrent writers and idempotency mismatch;
- crash injection at every transaction step;
- external edits and inspect-only transitions;
- accepted-change atomicity and projection staleness; and
- round-trip preservation of supported extension content.
