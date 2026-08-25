# dstar

**DSTAR is an open, portable protocol for reviewable documents.**

Agents increasingly write and maintain documents while people review
projections, leave comments, and make decisions. Existing formats do not make
that workflow portable: Markdown lacks durable review state, HTML mixes meaning
with presentation, and office or workspace applications keep comments and
suggestions inside proprietary systems.

DSTAR packages canonical content — the authoritative source of truth — with
annotations, proposed changes, sources, assets, provenance, and mapped
projections as distinct but connected objects.

> Agents produce. Humans decide.

## Status

DSTAR 0.1 is a pre-draft. Nothing in this repository is stable yet. The first
goal is to specify and test one complete workflow:

1. An agent creates or updates canonical content.
2. A human reads a rich or summarized projection.
3. The human comments on a durable target.
4. The agent proposes a structured, conflict-aware change.
5. A human accepts or rejects the proposal.
6. Projections regenerate without losing the review context.

## Repository layout

```text
spec/0.1/
├── DSTAR.md              Normative entry point and conformance
├── document-model.md     Nodes, identity, profiles, and revisions
├── annotations.md        Threads and durable multi-selector targets
├── changes.md            Proposed operations and human decisions
├── projections.md        Addressable views and source mappings
├── schemas/              Machine-readable structural rules
├── examples/             Documents for learning and testing
└── tests/                Conformance fixtures
```

Implementations will be added only after the core 0.1 model is coherent. The
planned reference implementation will include a validator, renderer, CLI, MCP
server, and review UI, but none of those applications defines the protocol by
itself.

## Design principles

- Portable review state over application-owned metadata
- Stable semantic identity with redundant anchors
- Local proposals over whole-document rewrites
- Human authority for agent-authored changes
- One canonical document with multiple addressable projections
- Small content core with explicit extension profiles
- Open, inspectable files and replaceable implementations
- Provenance and graceful degradation by default

See [VISION.md](VISION.md) and [spec/0.1/DSTAR.md](spec/0.1/DSTAR.md).
