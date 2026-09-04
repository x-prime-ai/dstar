# DSTAR design

The current implementation is the **HTML-first local MVP**, format
`dstar-html-0.2-dev`.

Start here:

- [Vision](../VISION.md): product and authority boundaries.
- [Architecture](architecture.md): skill → CLI/Engine → Viewer.
- [Viewer information architecture](viewer-ux.md): implemented reading,
  comments, versions and review-change UX.
- [Implemented format and limits](html-mvp.md): concrete storage, text anchors,
  safety profile, recovery and current limitations.
- [Implementation status](implementation-plan.md): delivered scope and next work.
- [Agent skill](../skills/dstar-documents/SKILL.md): executable workflows.
- [ADR 0001](decisions/0001-canonical-html.md): HTML as the only canonical artifact.
- [ADR 0002](decisions/0002-small-engine.md): no Git dependency, no required MCP/SDK,
  and version/delta generation during agent proposal submission.

The concrete MVP document and code define implementation behavior; the Vision
defines product intent. Superseded JSON-schema, renderer, MCP and application
designs have been removed so they cannot be mistaken for supported interfaces.
