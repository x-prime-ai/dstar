# Change Applier

Status: **Draft**

## 1. Purpose

The Change Applier is the deterministic authority gate between an agent-authored
proposal and canonical package state. It:

- validates proposal authorship, bases, references, and operation shape;
- simulates ordered operations without mutating the package;
- produces the review model shown to humans;
- records human rejection or supersession; and
- atomically materializes an accepted result.

It never invokes a model, chooses prose, guesses a target, or accepts on behalf
of a human.

## 2. Public interface

```ts
interface ChangeApplier {
  simulate(snapshot: PackageSnapshot, changeId: ChangeId): SimulationResult;
  accept(command: AcceptChangeCommand): Promise<PackageCommit>;
  reject(command: RejectChangeCommand): Promise<PackageCommit>;
  supersede(command: SupersedeChangeCommand): Promise<PackageCommit>;
}

interface VersionMaterializer {
  list(snapshot: PackageSnapshot): readonly CanonicalVersionSummary[];
  materialize(
    snapshot: PackageSnapshot,
    targetChangeId: ChangeId,
  ): VersionMaterialization;
}

interface AcceptChangeCommand {
  expectedSnapshotId: SnapshotId;
  idempotencyKey: string;
  changeId: ChangeId;
  actor: HumanActor;
  expectedResultRevision: Revision;
  reason?: string;
}
```

`expectedResultRevision` binds the human confirmation to the exact simulation
they reviewed. It is command metadata; the accepted decision stores that value
as `resultRevision` after independent recomputation.

The `VersionMaterializer` shares the applier's operation engine but exposes no
mutation or decision method. Its target must be an accepted change on the
validated chain.

## 3. Simulation result

```ts
type Applicability =
  | "applicable"
  | "stale-base"
  | "local-conflict"
  | "invalid";

interface SimulationResult {
  changeId: ChangeId;
  snapshotId: SnapshotId;
  applicability: Applicability;
  baseChangeMatches: boolean;
  baseRevisionMatches: boolean;
  resultingDocument?: DstarDocument;
  resultRevision?: Revision;
  operations: OperationSimulation[];
  semanticDiff?: SemanticDiff;
  diagnostics: Diagnostic[];
}
```

Simulation is pure for a given snapshot and change. It does not update proposal
status, delegation status, annotations, or runtime idempotency state.

## 4. Validation stages

1. Locate the change and require `kind: update`, `status: proposed`.
2. Require an agent author and valid motivation/delegation/source references.
3. Resolve `baseChange` to an accepted change and verify its accepted
   `resultRevision` equals `baseRevision`.
4. Compare bases with current manifest head and revision.
5. Clone the canonical tree into an isolated indexed working copy.
6. Evaluate and apply operations in serialized order.
7. Validate node identity, profiles, containment, references, and assets.
8. Compute RFC 8785 result revision and semantic diff.

Base mismatch yields `stale-base`. The applier may still run a diagnostic
simulation against current content to report whether local preconditions appear
valid, but it never labels that proposal applicable and never creates a rebased
change. A new agent-authored proposal is required.

## 5. Working-copy index

The mutable simulation index maintains:

- node ID -> node value;
- node ID -> parent ID and child index;
- parent ID -> ordered direct child IDs;
- depth-first reading order;
- node text streams; and
- node hash cache invalidated through ancestors after mutation.

Each operation sees the state produced by previous operations. Preconditions
are checked immediately before that operation. A failed operation stops
simulation; later operations are reported as not evaluated.

## 6. Common precondition rules

- A target node must exist exactly once.
- `nodeRevision` is recomputed from the current working-copy node using RFC 8785
  plus SHA-256.
- `expectedText` is valid only for an operation with an identified text range
  and, when present, must equal that range.
- Parent preconditions must hash the parent named by their corresponding origin
  or destination.
- Node hashes include descendants because they hash the complete node value.
- Preconditions are never updated or ignored by the applier.

Diagnostic output includes expected and actual hashes but does not include
unbounded node content.

## 7. Operation algorithms

### 7.1 `replace_text`

1. Resolve the target and verify its node precondition.
2. Require exactly one inline item of type `text` with no marks.
3. Convert its string to Unicode code points.
4. Require `0 <= start <= end <= length` and boundaries outside invalid scalar
   sequences; warn when a boundary splits a grapheme cluster.
5. Verify `expectedText` when present.
6. Replace `[start, end)` with the supplied string.
7. Keep the target node ID and all non-content fields unchanged.

JavaScript UTF-16 substring APIs are not used without explicit code-point
conversion.

### 7.2 `replace_inline`

1. Resolve the target and verify its complete node hash.
2. Validate every new inline item and mark against declared profiles.
3. Replace the entire `content` array with the proposed value.
4. Preserve node ID, type, attrs, and children.
5. Validate the resulting node's containment/profile rules.

There is no mark inheritance or implicit normalization. Adjacent text runs are
not merged unless a future profile explicitly defines canonical normalization.

### 7.3 `insert_node`

1. Resolve destination parent and verify its parent precondition.
2. Validate the complete inserted subtree and require every inserted ID to be
   absent from the working document.
3. Resolve the insertion position:
   - `before`: referenced ID must be a direct child; insert at its index;
   - `after`: referenced ID must be a direct child; insert after it;
   - `index`: require `0 <= index <= childCount`;
   - omitted: append.
4. Insert once and validate parent containment.

The operation cannot add an asset file. Every asset referenced by the inserted
subtree must already exist in the package in 0.1.

### 7.4 `delete_node`

1. Reject deletion of the root.
2. Resolve target and origin parent; require target to be its direct child.
3. Verify target and origin-parent preconditions.
4. Remove the target subtree from the parent and index.
5. Validate parent containment and references required to resolve in the new
   current revision. Historical annotation targets may become orphaned.

Deletion does not automatically delete assets, sources, annotations,
delegations, or history. Existing annotations may become orphaned by design.
Assets remain until an explicit future asset-lifecycle operation or safe package
maintenance rule exists.

### 7.5 `move_node`

1. Reject moving the root.
2. Resolve target, origin parent, and destination parent.
3. Require target to be a direct child of origin.
4. Verify target, origin-parent, and destination-parent preconditions. When
   origin equals destination, both parent hashes must be identical.
5. Reject a destination inside the target subtree.
6. Reject `before` or `after` referring to the target itself.
7. Remove the target from its origin.
8. Resolve `before`/`after` against stable direct-child IDs after removal.
9. Interpret `index` against the destination children after removal when moving
   within the same parent, otherwise against the existing destination children.
10. Insert exactly once and validate both affected parents.

The node and all descendants retain IDs.

### 7.6 `set_attrs`

1. Resolve target and verify its node precondition.
2. If `value` is an object, replace the complete `attrs` member with that object.
3. If `value` is `null`, remove the `attrs` member.
4. Validate type-specific required and allowed attributes.
5. Preserve ID, type, inline content, and children.

`set_attrs` is not a merge patch. Missing object keys are removed.

## 8. Multi-operation behavior

Operations are ordered and atomic. Later operations may intentionally target a
node inserted or modified earlier, and their preconditions must describe that
intermediate state.

If any step fails:

- no working-copy result is considered applicable;
- no package file or proposal status changes;
- the first failure and any directly caused skipped operations are reported;
- deterministic diagnostics are returned to the reviewer/agent; and
- retrying simulation produces the same result for the same snapshot.

## 9. Semantic diff

The diff compares base and simulated trees by stable node ID:

- inserted IDs and destination hierarchy;
- deleted IDs and former hierarchy;
- moved IDs with old/new parent and sibling context;
- text/inline changes with code-point ranges and mark changes;
- attribute replacement/removal; and
- unsupported or ambiguous identity changes.

The renderer may create a visual diff from this model. It does not compare
generated HTML or JSON line numbers as the primary review representation.

## 10. Acceptance

Acceptance requires:

- proposal still `proposed`;
- fresh `expectedSnapshotId`;
- current bases equal proposal bases;
- authorized human actor;
- clean applicable simulation;
- command `expectedResultRevision` equals recomputed result;
- package strict validation; and
- unused command idempotency key or a matching prior result.

The resulting `PackageCommit` writes canonical document, accepted decision, and
manifest revision/head together as defined by the package runtime. The applier
does not resolve motivating annotations or alter delegations.

If the same accept command is repeated after success, the idempotency ledger
returns the committed snapshot. Reusing its key with different arguments is an
error.

## 11. Rejection and supersession

Reject and supersede commands require a proposed change, fresh snapshot, and
authorized human actor. They create a decision with no `resultRevision` and
write only the change record.

- Rejection says the human declined that proposal.
- Supersession says the proposal is obsolete, usually because another proposal
  exists or intent changed.

The application never marks a proposal superseded merely because a replacement
was generated; that remains an explicit human decision.

## 12. Genesis acceptance

Genesis uses the same deterministic document/profile validation but begins from
no package snapshot. The draft transaction verifies:

- exactly one `create_document` operation;
- human request and agent author;
- no base fields;
- result revision of the proposed root;
- staged sources and assets; and
- safe unused output directory.

Acceptance materializes the root, accepted genesis, manifest with
`headChange = genesis.id`, sources/assets, and initial directory structure. If
the target exists, acceptance fails rather than merging or overwriting it.

## 13. Historical version materialization

The materializer constructs the accepted-chain prefix from genesis to the
requested change, validates genesis, and applies each accepted update in order
to an isolated working tree. At every step it verifies `baseChange`,
`baseRevision`, operation preconditions, profile validity, and the decision's
`resultRevision`.

The returned value contains:

- target accepted change ID;
- verified content revision;
- materialized canonical tree;
- ordered accepted provenance summaries; and
- diagnostics and unsupported-profile capabilities.

For the head target, the result must equal the parsed `document.json` value and
manifest revision/head. Any mismatch invalidates materialization rather than
choosing one source silently. Local checkpoints may skip already verified
prefix work, but they are keyed by the accepted-chain fingerprint, verified
before use, and never written into portable history.

Materialization does not reconstruct an old package snapshot. Current
annotations, delegations, sources, assets, and projections are not presented as
if they were their historical state. A version view labels them as current
state if it exposes them at all.

## 14. Asset limitation

The current update-operation vocabulary has no portable asset add/delete
operation or digest semantics. Therefore:

- genesis may materialize explicitly staged assets with the initial package;
- update proposals may only reference assets already present;
- the applier does not delete unreferenced assets; and
- introducing update-time asset operations waits for a spec revision.

This limitation must be visible in capabilities and proposal diagnostics.

## 15. Error taxonomy

```text
CHANGE_NOT_FOUND
CHANGE_NOT_PROPOSED
CHANGE_AUTHOR_INVALID
CHANGE_BASE_REFERENCE_INVALID
CHANGE_STALE_HEAD
CHANGE_STALE_REVISION
OP_TARGET_MISSING
OP_PRECONDITION_FAILED
OP_RANGE_INVALID
OP_EXPECTED_TEXT_MISMATCH
OP_ORIGIN_MISMATCH
OP_DESTINATION_INVALID
OP_ID_COLLISION
OP_CONTAINMENT_INVALID
OP_PROFILE_UNSUPPORTED
RESULT_REVISION_MISMATCH
VERSION_TARGET_NOT_ACCEPTED
VERSION_CHAIN_INVALID
VERSION_HEAD_DOCUMENT_MISMATCH
DECISION_ACTOR_UNAUTHORIZED
COMMAND_SNAPSHOT_STALE
COMMAND_IDEMPOTENCY_MISMATCH
```

Portable diagnostic encoding is not yet in the spec, so these codes are stable
reference-implementation API values, not serialized change fields.

## 16. Tests

- One golden before/change/after triple for every operation.
- Unicode code-point and grapheme-boundary cases.
- Ordered multi-operation dependencies and atomic rollback.
- Source-parent relocation conflicts for delete and move.
- Same-parent move indexes before/after removal.
- Stable-ID diff tests for insert, delete, move, and copy.
- Stale head versus local precondition diagnostics.
- No-op and content-reverting accepted history.
- Genesis, intermediate, and head version materialization with repeated content
  revisions.
- Corrupted intermediate operations/result revisions and head/document mismatch.
- Equivalent results with cold, warm, deleted, and invalidated checkpoints.
- Idempotent acceptance and mismatched key reuse.
- Crash injection delegated to package transaction tests.
- Property tests comparing incremental working-copy indexes with a rebuilt tree.
