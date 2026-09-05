# DSTAR design

The current implementation is the **HTML-first local MVP**, format
`dstar-html-0.2-dev`.

Start here:

- [Public documentation](../docs/README.md): task-oriented SDK, MCP, Viewer,
  HTTP API, CLI and deployment guides.
- [Vision](../VISION.md): target users, multi-round review value and product
  boundaries.
- [Roadmap](roadmap.md): priorities, milestone exit evidence and deferred work.
- [Delivery plan](delivery-plan.md): standalone implementation and verification
  status plus deferred evidence limits.
- [Review rounds](review-rounds.md): implemented durable batch feedback and host
  callback contracts plus the deferred cross-product validation boundary.
- [Architecture](architecture.md): skill → CLI/Engine → Viewer.
- [Viewer information architecture](viewer-ux.md): implemented reading,
  comments, versions and review-change UX.
- [Implemented format and limits](html-mvp.md): concrete storage, text anchors,
  safety profile, recovery and current limitations.
- [Implementation status](implementation-plan.md): delivered foundations and
  verification scope.
- [Agent skill](../skills/dstar-documents/SKILL.md): executable workflows.
- [ADR 0001](decisions/0001-canonical-html.md): HTML as the only canonical artifact.
- [ADR 0002](decisions/0002-small-engine.md): no Git or required MCP dependency,
  and version/delta generation during agent proposal submission.
- [ADR 0003](decisions/0003-host-owned-runtime.md): public TypeScript and
  self-hosted Viewer boundaries, with no central DSTAR service dependency.

The concrete MVP document and code define implementation behavior; the Vision
defines product intent, and the roadmap defines future priorities. Planned
designs do not create supported APIs. Superseded JSON-schema, renderer, MCP and
application designs have been removed so they cannot be mistaken for supported
interfaces.
