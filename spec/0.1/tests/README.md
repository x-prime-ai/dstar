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

## Planned Review Client fixtures

- exact node and text target
- stale position recovered by quotation and context
- ambiguous quotation remains unattached
- missing node produces `orphaned`
- HTML selection within one mapped segment resolves to an exact canonical range
- HTML selection across mapped elements produces a `SegmentRangeSelector`
- projection comment includes all intersected canonical targets
- projection comment without canonical targets is invalid
- transformed or summarized mapping does not invent an exact source range
- projection-scoped feedback does not request a canonical change
- a direct document target with projection scope is invalid
- agent-context projection omits human-only annotations
- a selection in a canonical HTML view targets `document`
- ambiguous projection regeneration remains unresolved and preserves provenance

## Planned Core Writer fixtures

- accepted genesis materializes the proposed root and canonical revision
- accepted update produces the recorded resulting revision
- proposed, rejected, or superseded changes do not modify canonical content
- moving a semantic node preserves its ID
- copying, splitting, or merging does not duplicate or ambiguously reuse an ID
- unsupported declared-profile content survives an accepted transformation

## Planned Delegation Client fixtures

- a comment remains valid and open without a delegation
- a queued delegation references an existing annotation and agent
- completing a delegation does not resolve its source annotation
- a completed delegation links to an agent-authored result change
- reassigning work creates a new delegation
- a human or service assignee is invalid

## Planned Change fixtures

- valid agent-authored genesis proposal
- valid agent-authored update using `replace_text`
- genesis with a base revision or update without one is invalid
- stale base revision
- matching base with failed local node precondition
- stale base with locally valid operations produces an explicit rebase
- duplicate idempotency key does not apply twice
- multi-operation change is atomic on failure
- a human or service change author is invalid in 0.1
- an agent, service, or policy decision actor is invalid in 0.1
- accepted genesis records the correct resulting revision
- accepted change records the correct resulting revision
- rejected change leaves canonical content unchanged
- a failed application attempt leaves the proposal payload and status unchanged

## Planned Projection Renderer fixtures

- summary segment maps to an existing canonical node
- reviewable HTML exposes indexed `data-dstar-segment` values
- a reviewable projection without complete segment mapping is invalid
- exact, transformed, and summarizes mappings are preserved
- projection hash matches raw artifact bytes
- regenerated projection preserves review context
- regenerated projection with ambiguous mapping remains visibly unresolved
- missing source node in `derivedFrom` is invalid
- unsupported canonical node emits a diagnostic or fallback

Until the semantic rules stabilize, this directory contains only the test plan.
