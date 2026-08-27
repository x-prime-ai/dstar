# DSTAR Reference Implementation Design

Status: **Draft**

This directory describes the first DSTAR reference implementation. It is
non-normative: the protocol in [`spec/0.1`](../spec/0.1/DSTAR.md) remains the
authority for portable files and interoperable behavior.

The design makes one implementation concrete enough to build and test. Other
implementations may use different languages, storage engines, renderers, host
applications, or interfaces while conforming to the protocol.

## Documents

- [Architecture](architecture.md) — system boundary, components, processes,
  internal interfaces, and end-to-end flows.
- [Package runtime](package-runtime.md) — safe package loading, snapshots,
  validation, locking, atomic writes, recovery, and local runtime state.
- [MCP server](mcp-server.md) — scoped resources and document tools, transport,
  capability enforcement, and the human-authority boundary.
- [xPrime integration request](xprime-integration-request.md) — requested MCP
  Resources and Apps client capabilities and their authority constraints.
- [Review client](review-client.md) — canonical and projection views, browser
  selection conversion, comments, human assignment, proposal and version review, and
  target recovery.
- [Renderer](renderer.md) — profile registry, canonical HTML, projection
  generation, source maps, assets, sanitization, and regeneration.
- [Evidence and assets](evidence-assets.md) — source registration, file capture,
  asset handling, retention, integrity limits, and future protocol needs.
- [Change applier](change-applier.md) — deterministic operation semantics,
  preconditions, simulation, decisions, historical materialization,
  idempotency, and transactions.
- [Security](security.md) — threat model, trust boundaries, package and HTML
  safety, caller isolation, secrets, and approval controls.
- [SDK-first roadmap](implementation-plan.md) — public packages, milestones,
  tests, exit criteria, and delivery sequencing.

## Authority order

When documents disagree, use this order:

1. [`VISION.md`](../VISION.md) defines product intent and authority principles.
2. [`spec/0.1`](../spec/0.1/DSTAR.md) defines portable representation and
   conforming behavior.
3. This directory defines the reference implementation.
4. Source code and tests must be corrected when they contradict the documents
   above.

Design discoveries that affect interoperability must be resolved in the spec,
not hidden as implementation behavior.

## Baseline decisions

The 0.1 reference implementation is:

- local-first and asynchronous;
- a strict TypeScript monorepo running on Node.js 22 or newer;
- a pure protocol core with no UI, filesystem, model-provider, or network
  dependency;
- a local workspace service used by the CLI and browser review application;
- a read-only React canonical renderer with explicit DOM-to-DSTAR mappings;
- integrated first with xPrime through a tool-complete MCP client boundary,
  without binding DSTAR to xPrime's execution model; and
- conservative about writes: package mutation always goes through validated,
  locked transactions.

Tiptap or ProseMirror may be used behind a future view adapter, but their JSON,
positions, transactions, and plugin state are never canonical DSTAR data. The
0.1 client does not use a rich-text editing surface because humans do not edit
canonical content directly.
