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

The root MUST have type `document`. The initial conformance examples exercise
only `document`, `heading`, and `paragraph`; detailed containment rules for the
remaining types are still pre-draft.

## Inline content

Inline content is an ordered array. The required base inline type is `text`:

```json
{
  "type": "text",
  "text": "Agents produce. Humans decide.",
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

Cross-node text ranges are not part of the base 0.1 profile.

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
