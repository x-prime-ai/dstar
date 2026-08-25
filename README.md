# dstar

**DSTAR is an open, portable protocol for AI-native collaborative documents.**

Humans and agents increasingly create and maintain documents together. Existing
formats do not make that collaboration portable: Markdown has limited
expressive power and no durable review state, HTML mixes meaning with
presentation, and office or workspace applications keep content, comments, and
automation inside proprietary systems.

DSTAR packages agent-authored canonical content — the authoritative semantic
source of truth — with comments, delegations, proposals, sources, assets,
provenance, and mapped projections as distinct but connected objects. A rich
HTML view, summary, and agent context can serve different needs without becoming
different documents.

> Agents author. Humans direct and decide.

## Status

DSTAR 0.1 is a pre-draft. Nothing in this repository is stable yet. The first
goal is to specify and test one complete authoring and review workflow:

1. An agent proposes the initial semantic document and a human accepts it.
2. A person reads and comments through a rich web experience.
3. The comment remains open for discussion or is explicitly delegated.
4. An agent returns a structured, conflict-aware proposal.
5. An authorized human accepts or rejects the proposal.
6. Views regenerate without silently losing review provenance.

## Repository layout

```text
spec/0.1/
├── DSTAR.md              Normative entry point and conformance
├── document-model.md     Nodes, identity, profiles, and revisions
├── annotations.md        Threads and durable multi-selector targets
├── changes.md            Agent creation and update proposals
├── delegations.md        Optional assignment of comments to agents
├── projections.md        Addressable views and source mappings
├── schemas/              Machine-readable structural rules
├── examples/             Documents for learning and testing
└── tests/                Conformance fixtures
```

Implementations will be added only after the core 0.1 model is coherent. The
planned reference implementation will include a validator, rich web reader,
renderer, CLI, MCP server, and review UI, but none of those
applications defines the protocol by itself.

## Design principles

- Agents author canonical content; humans direct and decide
- Direct human comments, with delegation as a separate action
- Portable collaboration state over application-owned metadata
- Stable semantic identity with redundant anchors
- Local proposals over whole-document rewrites after genesis
- Explicit human approval for every canonical change
- One canonical document with multiple addressable views
- Rich expression through semantic profiles and renderers
- Small content core with explicit extension profiles
- Open, inspectable files and replaceable implementations
- Provenance and graceful degradation by default

See [VISION.md](VISION.md) and [spec/0.1/DSTAR.md](spec/0.1/DSTAR.md).
