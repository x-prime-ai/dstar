# Projections

Status: **Pre-Draft**

A projection is a derived, addressable representation of the canonical
document for a particular consumer or purpose.

Expected roles include:

- `reading` for rich human reading;
- `summary` for progressive disclosure;
- `source` for portable Markdown or another authoring syntax;
- `plain-text` for search and accessibility; and
- `agent-context` for targeted machine operations.

## Projection index

When `projections/` exists, `projections/index.json` MUST describe every
projection artifact in the package. A projection record contains:

- a stable projection ID;
- its role, media type, and package-relative path;
- the canonical revision from which it was generated;
- a SHA-256 revision of its own raw bytes;
- optional generator provenance; and
- zero or more stable segments mapping parts of the view to canonical targets.

The artifact is not canonical document content. Its identity and mapping are
nevertheless portable review data.

## Segments and source mapping

A projection segment identifies a range or semantic unit within a projection
and lists one or more canonical targets in `derivedFrom`.

For plain-text formats, a segment uses position and quotation selectors over the
projection text. Structured renderers MAY embed the segment ID in DOM or editor
metadata, but that embedded representation is not the source of identity.

Summary claims SHOULD map to the smallest canonical nodes that support them.
When a statement combines several sections, `derivedFrom` contains all relevant
targets.

## Review on a projection

A comment created while viewing a projection targets its stable segment and
projection revision. The Review Client also copies an appropriate canonical
target into the annotation as specified in `annotations.md`.

After regeneration, a client MAY use the segment mapping and quotation to show
the annotation in the new view. It MUST preserve the original projection
revision and quotation as review provenance.

## Regeneration and deletion

Projection artifacts MAY be regenerated from canonical content. Regeneration
changes the projection revision and MAY retain a projection or segment ID only
when its semantic purpose remains the same.

An unreferenced projection artifact MAY be deleted. If an annotation targets a
projection, a tool deleting or replacing it MUST preserve the projection record,
segment mapping, and annotation quotations needed to explain the original
review. A compact implementation may retain only this metadata rather than the
entire old artifact.

## Rendering requirements

A Projection Renderer SHOULD report unsupported nodes instead of silently
dropping meaningful content. Agent-context renderers MUST respect annotation
audience metadata.

Canonical rendering algorithms and cross-renderer layout equivalence are not
defined in DSTAR 0.1.
