# Document Model

Status: **Pre-Draft**

## Base document profile

The canonical document is an ordered semantic tree. The `dstar:base` profile is
intentionally smaller than an editor's internal schema so independent tools can
implement it without adopting a particular editing framework.

A node contains:

- `id`: a stable, opaque identifier;
- `type`: a base or profile-defined node type;
- `attrs`: optional type-specific properties;
- `content`: optional ordered inline content; and
- `children`: optional ordered child nodes.

Node identity is independent of tree position. Reordering a node does not create
a new node. A renderer's DOM path, ProseMirror position, or CRDT item ID is not a
DSTAR node ID.

## Rich content boundary

The canonical tree stores meaning and structure, not a browser DOM or
a complete presentation program. The base profile covers common document
semantics; declared profiles may add figures, citations, equations, charts,
callouts, media, interactive components, layout hints, or domain-specific
objects.

Renderers combine canonical nodes, profiles, assets, and a theme to create a
polished HTML or other human experience. Presentation that does not change the
document's meaning belongs in the renderer or projection. Meaningful content
MUST NOT exist only in generated markup if it is expected to survive accepted
changes, export, or a change of implementation.

An implementation that cannot render or transform a profile-defined object MUST
preserve it losslessly and provide a visible fallback or diagnostic. Richness is
therefore extensible without making one editor schema or arbitrary HTML
canonical.

## Base node types

DSTAR 0.1 reserves these types in the `dstar:base` profile:

- `document`
- `section`
- `heading`
- `paragraph`
- `blockquote`
- `list`
- `list_item`
- `code_block`
- `table`
- `table_row`
- `table_cell`
- `image`
- `embed`

The root MUST have type `document`. DSTAR 0.1 initially defines complete
containment and attributes only for the types exercised by the first vertical
slice:

- `document` contains ordered block children;
- `heading` contains inline content and has an integer `level` from 1 through 6;
- `paragraph` contains inline content; and
- `image` is a leaf with package-relative `src` and human-readable `alt`
  attributes.

Detailed containment rules for the remaining reserved types are still
pre-draft. A base-profile writer MUST NOT emit one until its 0.1 rules are
defined; a third-party profile may define a namespaced alternative.

## Authoring boundary

The initial root document is introduced by a genesis proposal. Every later
canonical transformation is also represented by a proposal using the
operations in [Changes](changes.md). A Core Writer materializes canonical
content only after an authorized human accepts the proposal.

Human selection, comment, assignment, and decision actions do not directly
mutate this tree. A DSTAR 0.1 authoring client MUST NOT serialize DOM mutations,
editor-specific JSON, exact human replacement text, or transient selection
positions as a human-authored canonical change.

This is a behavioral boundary for conforming tools, not a cryptographic claim
about the package's filesystem history.

## Inline content

Inline content is an ordered array. The required base inline type is `text`:

```json
{
  "type": "text",
  "text": "Tools propose. Humans review and decide.",
  "marks": [
    { "type": "strong" }
  ]
}
```

The base mark types are:

- `strong`
- `emphasis`
- `code`
- `link`

A `link` mark MUST contain an `href` attribute. Profiles MAY define additional
inline and mark types. Unknown types from a declared profile MUST survive a
lossless read and write even if the implementation cannot render them.

## Text stream

For anchoring and text operations, a node's text stream is the concatenation of
the `text` values in its inline content in document order. Marks do not add
characters to the stream.

Offsets count Unicode code points from zero. A start offset is inclusive and an
end offset is exclusive. Producers SHOULD NOT create a range boundary inside a
grapheme cluster. Adapters for editors that use UTF-16 or another coordinate
system MUST convert at the protocol boundary.

Canonical selections may cross nodes through `NodeRangeSelector`. Its endpoints
remain offsets in the individual node text streams. LF-normalized range
quotation provides redundant evidence but does not create a global concatenated
offset coordinate space.

## Identity across accepted transformations

Changing a node's text or attributes, or moving the same semantic object within
the tree, SHOULD preserve its ID. Copying an object creates a new ID.

Splitting one semantic object into multiple objects or merging multiple objects
creates new semantic identity. Until DSTAR defines portable lineage, a 0.1
writer SHOULD assign new IDs to every split or merged result rather than attach
an old ID to an arbitrary descendant. Existing annotations then resolve through
their redundant anchors or become explicitly ambiguous or orphaned.

Implementations MAY retain richer local lineage to assist recovery, but they
MUST NOT silently claim an exact target when the relationship is ambiguous.

## Revision

The canonical revision is computed from the complete root node according to the
algorithm in `DSTAR.md`. Stable IDs are part of canonical content and therefore
part of the revision.

Local node hashes used as change preconditions use the same RFC 8785 plus
SHA-256 algorithm over the selected node value.

## Invariants

A semantically valid document MUST satisfy:

- every node ID is unique in the document;
- the root node type is `document`;
- a node is present at most once in the tree;
- a node does not contain itself, directly or indirectly;
- a `text` inline object contains a `text` string;
- marks and node types belong to a declared profile; and
- registered node containment rules are satisfied.
