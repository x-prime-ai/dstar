# DSTAR 0.1 Conformance Fixtures

These fixtures will test behavior that JSON Schema alone cannot express.

```text
core-reader/          Package and canonical document behavior
core-writer/          Accepted genesis/update materialization and preservation
review-client/        Target resolution and thread lifecycle
delegation-client/    Explicit assignment and independent lifecycle behavior
change-producer/      Proposal construction and provenance
change-applier/       Conflict checks, atomicity, and decisions
projection-renderer/  Projection revisions and source mappings
```

Each role will contain valid packages, invalid packages with expected error
codes, and operation triples where behavior changes state.

## Planned Core Reader fixtures

- valid minimal `dstar:base` document
- manifest revision does not match canonical RFC 8785 hash
- duplicate node ID
- undeclared content profile
- unknown declared profile preserved losslessly
- package path escapes the package root
- package path uses a URI scheme, drive prefix, backslash, or dot segment
- missing `changes/` or accepted genesis record
- multiple accepted genesis records
- accepted change chain head does not produce the manifest revision
- accepted change chain branches or contains an accepted change off-chain
- accepted change chain contains a cycle or a missing `baseChange`
- a no-op or content-reverting update remains ordered by change ID

## Planned Review Client fixtures

- exact node and text target
- stale position recovered by quotation and context
- ambiguous quotation remains unattached
- missing node produces `orphaned`
- HTML selection within one mapped segment resolves to an exact canonical range
- HTML selection across mapped elements produces a `SegmentRangeSelector`
- projection comment includes all intersected canonical targets
- projection source map preserves an exact cross-node `NodeRangeSelector`
- projection comment without canonical targets is invalid
- transformed or summarized mapping does not invent an exact source range
- projection-scoped feedback does not request a canonical change
- a direct document target with projection scope is invalid
- annotation scope and discussion purpose do not imply delegation
- agent-context projection omits human-only annotations
- a selection in a canonical HTML view targets `document`
- canonical HTML exposes `data-dstar-node` lookup aids
- a cross-node selection produces a valid `NodeRangeSelector`
- a cross-node canonical quote uses LF normalization and preserves `viewExact`
- a same-node `NodeRangeSelector` with reversed offsets is invalid
- ambiguous projection regeneration remains unresolved and preserves provenance

## Planned Core Writer fixtures

- accepted genesis materializes the proposed root and canonical revision
- accepted update produces the recorded resulting revision
- proposed, rejected, or superseded changes do not modify canonical content
- moving a semantic node preserves its ID
- copying, splitting, or merging does not duplicate or ambiguously reuse an ID
- unsupported declared-profile content survives an accepted transformation
- image and marked-link content survive an accepted transformation

## Planned Delegation Client fixtures

- a comment remains valid and open without a delegation
- a queued delegation references an existing annotation and agent
- completing a delegation does not resolve its source annotation
- a completed delegation links to an agent-authored result change
- a completed delegation links to an agent-authored reply result
- terminal delegation records `completedAt` and `completedBy`
- reassigning work creates a new delegation
- a human or service assignee is invalid

## Planned Change fixtures

- valid agent-authored genesis proposal
- genesis records its human request and evidence sources
- valid agent-authored update using `replace_text`
- valid `replace_inline` changes links and marks
- insert and move operations verify the destination parent
- delete and move operations verify the origin parent and reject relocation
- a destination using more than one positioning mode is invalid
- `set_attrs` replaces the complete attrs object and `null` removes it
- genesis with either base field or update without either base field is invalid
- update `baseChange` and `baseRevision` identify different accepted states
- stale base change or revision
- matching base with failed local node precondition
- stale base fields with locally valid operations produce an explicit rebase
- duplicate idempotency key does not apply twice
- multi-operation change is atomic on failure
- later operation preconditions are evaluated after earlier operations
- a human or service change author is invalid in 0.1
- an agent, service, or policy decision actor is invalid in 0.1
- accepted genesis records the correct resulting revision
- accepted change records the correct resulting revision
- top-level status and decision status mismatch is invalid
- rejected or superseded decision with `resultRevision` is invalid
- rejected change leaves canonical content unchanged
- a failed application attempt leaves the proposal payload and status unchanged

## Planned Projection Renderer fixtures

- summary segment maps to an existing canonical node
- reviewable HTML exposes indexed `data-dstar-segment` values
- rich HTML renders a marked link and package image with source mappings
- a reviewable projection without complete segment mapping is invalid
- exact, transformed, and summarizes mappings are preserved
- projection hash matches raw artifact bytes
- regenerated projection preserves review context
- regenerated projection with ambiguous mapping remains visibly unresolved
- missing source node in `derivedFrom` is invalid
- unsupported canonical node emits a diagnostic or fallback

Until the semantic rules stabilize, this directory contains only the test plan.
