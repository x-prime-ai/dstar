# Change Applier

Status: **Draft**

## Purpose and authority

The Change Applier is the deterministic gate between a pending proposal and
canonical package state. It validates and simulates proposed operations, builds
the review model, records an explicit human decision, and atomically
materializes an accepted result. It never chooses content or decides on behalf
of a human.

Proposal authorship and decision authority are independent. A valid portable
actor may author a proposal. Only a human actor may accept, reject, supersede,
or resolve canonical review state.

## Interface

```ts
interface ChangeApplier {
  simulate(snapshot: PackageSnapshot, changeId: ChangeId): SimulationResult;
  accept(command: AcceptChangeCommand): Promise<PackageCommit>;
  reject(command: RejectChangeCommand): Promise<PackageCommit>;
  supersede(command: SupersedeChangeCommand): Promise<PackageCommit>;
}

interface AcceptChangeCommand {
  expectedSnapshotId: SnapshotId;
  idempotencyKey: string;
  changeId: ChangeId;
  actor: HumanActor;
  expectedResultRevision: Revision;
}
```

`expectedResultRevision` binds the decision to the exact deterministic result
the reviewer saw. Historical materialization shares the operation engine but
exposes no mutation method.

## Simulation

Simulation is pure for a snapshot and proposal. It returns `applicable`,
`stale-base`, `local-conflict`, or `invalid`, together with per-operation
results, diagnostics, semantic diff, and the computed result revision.

Validation proceeds in this order:

1. require an update in `proposed` state and validate all portable references;
2. resolve `baseChange` and verify its accepted revision equals `baseRevision`;
3. compare those explicit bases with the current manifest;
4. apply serialized operations to an isolated indexed copy;
5. validate identity, containment, profiles, references, and assets; and
6. compute the RFC 8785 document revision and semantic diff.

A stale proposal is never silently rebased. A caller must submit a new proposal
with new explicit bases.

Each operation sees earlier operations in the same proposal. Preconditions are
checked immediately before application, and the first failure prevents later
operations from being considered applied. Unicode text offsets are code-point
offsets; JavaScript UTF-16 slicing is not used without conversion.

The six operation algorithms follow the normative definitions in
[`spec/0.1/changes.md`](../spec/0.1/changes.md): `replace_text`,
`replace_inline`, `insert_node`, `delete_node`, `move_node`, and `set_attrs`.
The applier performs no implicit normalization, target guessing, asset fetch,
or unrelated collaboration-state mutation.

## Decisions

Acceptance requires a fresh snapshot, matching bases, a human actor, a clean
simulation, an exact result revision, strict package validation, and a matching
or unused idempotency key. One recoverable transaction writes:

- the new canonical document;
- the accepted change with its human decision; and
- the manifest with matching `revision` and `headChange`.

Rejection and supersession only update the proposed change. They never alter
canonical content. Motivating comments remain independent and are not resolved
automatically.

Genesis uses the same document/profile validation with no prior package. A
caller may stage one proposed `create_document` change that preserves the human
draft request. A separate human acceptance creates the package in a previously
unused `.dstar` directory.

## History and assets

Version materialization validates the accepted chain from genesis through the
requested change, replays operations, and verifies every recorded result
revision. It materializes canonical content only; current annotations, sources,
assets, and projections are never presented as historical snapshots.

The 0.1 update vocabulary cannot add or delete asset files. Genesis may stage
initial assets; update proposals may only reference assets already present.

## Tests

- golden before/change/after vectors for all operations;
- Unicode boundaries and ordered multi-operation dependencies;
- stale bases, conflicts, atomic failure, and no silent rebase;
- exact-result human acceptance and idempotent retry;
- genesis and accepted-chain materialization;
- corrupted history and head/document mismatch; and
- property checks comparing incremental indexes with rebuilt trees.
