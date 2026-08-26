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

## Canonical views and projections

A canonical view faithfully renders the current semantic tree and is not a
separately versioned artifact. A human selection in that view targets
`document` directly.

A projection is a separately versioned artifact derived from a canonical
revision. A human selection in a projection targets the artifact the person
actually saw and copies its source mappings back to canonical content.

Both may look like polished HTML in a browser. Neither provides direct canonical
editing in DSTAR 0.1. Human actions create comments, delegations, replies, or
decisions; agents alone create canonical content proposals.

## Projection index

When `projections/` exists, `projections/index.json` MUST describe every
projection artifact in the package. A projection record contains:

- a stable projection ID;
- its role, media type, and package-relative path;
- whether the projection supports portable selection review;
- the canonical revision from which it was generated;
- a SHA-256 revision of its own raw bytes;
- optional generator provenance; and
- zero or more stable segments mapping parts of the view to canonical targets.

The artifact is not canonical document content. Its identity and mapping are
nevertheless portable review data.

## Reviewable projections

The `reviewable` field declares whether a conforming Review Client can turn an
arbitrary visible selection into a durable projection target and one or more
canonical targets.

A reviewable projection MUST provide sufficient segment mapping to cover every
selectable meaningful region. A projection without such a mapping may still be
displayed, but a client MUST NOT claim that its comments reliably link to
source-of-truth content.

## Segments and source mapping

A projection segment identifies a range or semantic unit within a projection
and lists one or more canonical targets in `derivedFrom`.

Each source mapping contains a canonical `NodeSelector` or
`NodeRangeSelector` and declares a relationship:

- `exact` — projection text is directly traceable to canonical text;
- `transformed` — source content has been structurally or textually transformed;
- `summarizes` — the projection synthesizes or summarizes source content.

`NodeRangeSelector` uses the canonical LF-normalized range text defined in
[Annotations](annotations.md). A projection renderer MAY additionally retain
`viewExact` when its presentation uses different visible separators.

For plain-text formats, a segment uses position and quotation selectors over
decoded projection text. For HTML, a segment SHOULD use a `FragmentSelector`
matching a `data-dstar-segment` value and SHOULD include quotation evidence for
the element's visible text.

Structured renderers MAY embed segment IDs in DOM or editor metadata, but the
embedded representation is only a lookup aid. The projection index is the
portable source map.

Segments MUST be ordered by projection reading order. This makes a
`SegmentRangeSelector` deterministic when a visible selection crosses elements.

## Mapping granularity

An exact mapping SHOULD identify the smallest canonical node or node range that
can be translated without changing meaning. A transformed mapping SHOULD
identify the smallest reliable source container without inventing an exact
range.

Summary claims SHOULD map to all canonical nodes that support them. When a
statement combines several sections, `derivedFrom` contains one `summarizes`
entry for each relevant source target.

## Review on a projection

A comment created while viewing a projection records the projection revision
and either a `SegmentSelector` or `SegmentRangeSelector`. The Review Client also
copies every intersected source mapping's relation and canonical selector into
the annotation's `canonicalTargets`, adding source `document` and the
projection's `generatedFromRevision`.

The annotation `scope` records whether the discussion concerns the canonical
document, the projection or its generator, or both. Its `purpose` records why
the comment exists. Neither field invokes an agent, and source mappings do not
imply edit intent.

After regeneration, a client MAY use canonical targets and the new source map
to show the annotation in the new view only when the mapping is unique and
unambiguous. It MUST preserve the original projection revision, visible
quotation, and copied mappings as review provenance. If exact or unambiguous
reattachment is impossible, the client MUST keep the thread visible as
unresolved review work rather than silently choosing a new location.

## HTML projections

HTML is the primary rich human projection expected in DSTAR 0.1. A renderer may
combine semantic nodes, declared profiles, package assets, and a theme to
produce tables, figures, media, citations, accessible fallbacks, and other
polished presentation. Meaningful content MUST remain traceable to canonical
nodes and MUST NOT exist only in generated markup.

A reviewable HTML projection SHOULD use markup such as:

```html
<p data-dstar-segment="segment_html_promise">
  Agents author. Humans direct and decide.
</p>
```

The HTML renderer maps this segment in `projections/index.json`. Browser DOM
ranges are converted to offsets relative to the segment's visible text stream.
CSS selectors, XPath, and DOM indexes are not durable DSTAR identity.

The base specification does not yet define a byte-for-byte HTML text
normalization algorithm. A renderer MUST therefore preserve exact quotation
evidence and SHOULD avoid splitting semantically continuous text across
unmapped DOM nodes.

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
