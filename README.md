# dstar

**DSTAR is an open, portable protocol for collaborative documents.**

Documents are increasingly read and modified through many applications and
automation tools. Existing formats do not make that collaboration portable: Markdown has limited
expressive power and no durable review state, HTML mixes meaning with
presentation, and office or workspace applications keep content, comments, and
automation inside proprietary systems.

DSTAR packages canonical content — the authoritative semantic source of truth
— with comments, human assignment, proposals, sources, assets,
provenance, accepted version history, and mapped projections as distinct but
connected objects. A rich HTML view, summary, and machine-readable context can serve
different needs without becoming different documents.

> Tools propose. Humans review and decide.

## Status

DSTAR 0.1 is a pre-draft. Nothing in this repository is stable yet. The first
goal is to specify and test one complete authoring and review workflow:

1. A caller proposes the initial semantic document and a human accepts it.
2. A person reads and comments through a rich web experience.
3. The comment remains open for discussion and may be assigned to a human.
4. An authorized caller returns a structured, conflict-aware proposal on that
   human's behalf.
5. An authorized human accepts or rejects the proposal.
6. Views regenerate without silently losing review provenance.
7. Any accepted canonical version can be materialized from portable history.

## Repository layout

```text
├── VISION.md             Product intent and authority principles
├── spec/0.1/             Normative protocol, schemas, examples, and fixtures
└── design/               Non-normative reference implementation design
```

Implementations will be added only after the core 0.1 model is coherent. The
reference roadmap is SDK-first: protocol core, safe Node package runtime, MCP
server and xPrime integration, deterministic renderer, then the comment/review
UI. None of those applications defines the protocol by itself.

## Design principles

- Caller-independent protocol and SDK boundaries
- Direct comments with optional human-only assignment
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
The non-normative reference implementation design starts at
[design/README.md](design/README.md).
