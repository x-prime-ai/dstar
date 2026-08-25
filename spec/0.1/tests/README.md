# DSTAR 0.1 Conformance Fixtures

These fixtures will test behavior that JSON Schema alone cannot express.

```text
core-reader/          Package and canonical document behavior
review-client/        Target resolution and thread lifecycle
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
- projection comment includes a valid canonical target
- projection comment without a canonical target is invalid
- agent-context projection omits human-only annotations

## Planned Change fixtures

- valid proposed `replace_text`
- stale base revision
- matching base with failed local node precondition
- stale base with locally valid operations produces an explicit rebase
- duplicate idempotency key does not apply twice
- multi-operation change is atomic on failure
- agent self-approval is invalid
- accepted change records the correct resulting revision
- rejected change leaves canonical content unchanged

## Planned Projection Renderer fixtures

- summary segment maps to an existing canonical node
- projection hash matches raw artifact bytes
- regenerated projection preserves review context
- missing source node in `derivedFrom` is invalid
- unsupported canonical node emits a diagnostic or fallback

Until the semantic rules stabilize, this directory contains only the test plan.
