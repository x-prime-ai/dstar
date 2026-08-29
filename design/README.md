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

Earlier design notes remain for context: [package runtime](package-runtime.md),
[renderer](renderer.md), [change applier](change-applier.md),
[review client](review-client.md), [evidence/assets](evidence-assets.md),
[security](security.md), [MCP](mcp-server.md), and
[xPrime integration](xprime-integration-request.md).
They describe broader or superseded plans, not the shipped contract.
In particular, their manifest layout, normalized-text rules, MCP/SDK roadmap and
assignment features are not implemented by the new path.

The older `spec/0.1`, JSON schemas, fixtures and legacy applications remain
separate. New packages are not claimed conformant to those schemas. The concrete
MVP document and code take precedence for implementation behavior; the Vision
defines product intent.
