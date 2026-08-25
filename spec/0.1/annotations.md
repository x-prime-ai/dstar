# Annotations

Status: **Pre-Draft**

Annotations attach discussion or review state to a document without embedding
comment bodies in canonical content.

## Storage and thread model

Each annotation thread is stored as `annotations/<annotation-id>.json`. A
thread contains:

- a stable annotation ID;
- an annotation type;
- the scope of the requested review;
- a primary target representing what the author actually reviewed;
- zero or more canonical targets representing relevant source-of-truth content;
- an initial body and author;
- zero or more ordered replies;
- a status and lifecycle metadata; and
- an optional intended audience.

The base annotation type is `comment`. The base statuses are `open` and
`resolved`. Every reply has its own stable ID, body, author, and timestamp.

The thread file represents current portable state. A future event-log profile
may preserve every edit, reopen, and moderation action, but snapshot and event
semantics are not mixed in `annotations/`.

## Scope

`scope` states what the annotation asks a reviewer or agent to change:

- `canonical` — review or change source-of-truth content;
- `projection` — review only the selected view or its generator; or
- `both` — review canonical content and the selected projection.

A link to canonical content is provenance, not an instruction to edit it. For
example, “this summary is too verbose” has projection scope even though the
summary segment records which canonical nodes it summarizes.

An annotation directly targeting `document` MUST use canonical scope. An
annotation targeting a projection MAY use any scope.

## Target model

A target identifies a source, a source revision, and a selector. Canonical
content uses source `document`; a projection uses its projection ID.

A canonical selection uses `NodeSelector` with optional position and quotation
evidence:

```json
{
  "source": "document",
  "revision": "sha256:...",
  "selector": {
    "type": "NodeSelector",
    "node": "node_promise",
    "refinedBy": [
      {
        "type": "TextPositionSelector",
        "start": 16,
        "end": 29,
        "unit": "unicode-code-point"
      },
      {
        "type": "TextQuoteSelector",
        "exact": "Humans decide"
      }
    ]
  }
}
```

`TextPositionSelector` and `TextQuoteSelector` describe the same intended
segment using independent evidence. Position is fast but brittle. Exact text
and optional prefix/suffix provide validation and recovery after edits.

Node-level comments omit `refinedBy`.

## Projection selection

A selection contained within one mapped projection segment uses
`SegmentSelector`. Its refined text positions are relative to that segment's
visible text stream, not to raw HTML bytes:

```json
{
  "type": "SegmentSelector",
  "segment": "segment_html_promise",
  "refinedBy": [
    {
      "type": "TextPositionSelector",
      "start": 16,
      "end": 29,
      "unit": "unicode-code-point"
    },
    {
      "type": "TextQuoteSelector",
      "exact": "Humans decide"
    }
  ]
}
```

An arbitrary selection crossing mapped segments uses `SegmentRangeSelector`.
Its start and end are segment-relative points, and `exact` preserves the visible
text the user selected:

```json
{
  "type": "SegmentRangeSelector",
  "start": { "segment": "segment_a", "offset": 7 },
  "end": { "segment": "segment_c", "offset": 12 },
  "unit": "unicode-code-point",
  "exact": "the selected visible text"
}
```

CSS selectors, XPath expressions, and DOM child indexes MAY be transient editor
hints but MUST NOT be the only portable selector.

## Canonical targets

An annotation targeting a reviewable projection MUST copy the relevant source
mappings into `canonicalTargets`. Each target records one relationship:

- `exact` — projection text is directly traceable to the canonical node or
  range;
- `transformed` — the view reformats or rewrites the source, so only a broader
  source target is reliable; or
- `summarizes` — the selected claim is synthesized from one or more sources.

An arbitrary projection selection may intersect several mappings and therefore
produce several canonical targets. Implementations MUST NOT invent an exact
canonical range for transformed or summarized text.

Copying mappings into the annotation preserves review provenance if the
projection is later regenerated or removed. The projection index remains the
authority for current mappings; the annotation records the mappings that were
in effect when the review was created.

## HTML selection

A reviewable HTML renderer SHOULD emit `data-dstar-segment` on the smallest
practical DOM elements that correspond to indexed projection segments. When a
person makes a browser selection, a Review Client:

1. obtains the browser `Range`;
2. finds the containing or intersected DSTAR segments;
3. converts the visible selection to segment-relative Unicode-code-point
   offsets and quotation evidence;
4. copies intersected `derivedFrom` entries into `canonicalTargets`; and
5. stores the annotation outside the HTML artifact.

Embedded segment attributes are navigation aids. `projections/index.json` and
the annotation records provide the portable link to source-of-truth content.

## Target resolution

A Review Client resolving an inline canonical target MUST:

1. locate the stable node ID;
2. try the stored position against the target revision or current text;
3. verify the selected text against `exact` when present;
4. use `exact`, `prefix`, and `suffix` to recover a moved range; and
5. report one of `exact`, `recovered`, `ambiguous`, `orphaned`, or
   `missing-source`.

Projection target resolution first locates the segment or segment range in the
recorded projection revision, then applies the same quotation checks.

An implementation MUST NOT silently attach a comment to different text when
the target cannot be recovered unambiguously. Resolution state is computed by
the client and does not change the annotation's stored target.

## Audience

An annotation MAY declare one or more intended actor types in `audience`.
Conforming agent-context projections MUST omit annotations that do not include
`agent` in their audience.

Because a `.dstar` package is an inspectable file, `audience` is disclosure
metadata rather than access control. Sensitive material requires storage-level
security outside the base specification.

## Semantic validity

A semantically valid annotation MUST satisfy:

- its filename matches its `id` plus `.json`;
- all authors and lifecycle actors are valid actors;
- the primary source and selected node, segment, or segment range exist at
  creation time;
- a projection target belongs to a projection marked `reviewable`;
- a projection target has one or more canonical targets;
- canonical targets refer to the canonical revision used to generate the
  reviewed projection;
- position selectors have `start <= end` and valid code-point boundaries;
- a segment range follows projection reading order;
- replies have unique IDs within the thread; and
- resolved threads include `resolvedAt` and `resolvedBy`.
