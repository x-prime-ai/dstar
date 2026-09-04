# Architecture Decision Records

Architecture decisions use sequential four-digit identifiers and the template
in [`0000-template.md`](0000-template.md). An ADR records reference-implementation
choices; interoperability requirements must ultimately land in the replacement
portable specification and fixtures, not only in an ADR.

## Decisions

- [ADR 0001](0001-canonical-html.md) — make HTML the single canonical document
  artifact for the redesign.
- [ADR 0002](0002-small-engine.md) — keep a small independent Engine/CLI and
  Viewer; generate deltas during proposal submission, without Git or MCP.
- [ADR 0003](0003-host-owned-runtime.md) — make the integrating host own its
  runtime, data, identity and browser origin through public SDK/Viewer packages.
