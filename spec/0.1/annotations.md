# Annotations

Status: **Pre-Draft**

Annotations attach discussion or review state to a document without embedding
comment bodies in canonical content.

## Storage and thread model

Each annotation thread is stored as `annotations/<annotation-id>.json`. A
thread contains:

- a stable annotation ID;
- an annotation type;
- its discussion purpose and subject scope;
- a primary target representing what the author actually reviewed;
- zero or more canonical targets representing relevant source-of-truth content;
- an initial body and author;
- an optional human assignee;
- zero or more ordered replies;
- a status and lifecycle metadata; and
- an optional intended audience.

The base annotation type is `comment`. The base purposes are `discussion`,
`question`, and `change-request`. The base statuses are `open` and `resolved`.
Every reply has its own stable ID, body, author, and timestamp.

The thread file represents current portable state. A future event-log profile
may preserve every edit, reopen, and moderation action, but snapshot and event
semantics are not mixed in `annotations/`.

## Scope

`scope` states what the annotation is about, not what any client is authorized
or required to change:

- `canonical` — canonical source-of-truth content;
- `projection` — the selected view or its generator; or
- `both` — canonical content and the selected projection.

`purpose` states why the annotation exists:

- `discussion` — an observation or topic with no implied action;
- `question` — a request for information or clarification; or
- `change-request` — feedback that may lead to a content proposal.

Neither `scope` nor `purpose` starts external work or grants authority.

A link to canonical content is provenance, not an instruction to edit it. For
example, “this summary is too verbose” has projection scope even though the
summary segment records which canonical nodes it summarizes.

An annotation directly targeting `document` MUST use canonical scope. An
annotation targeting a projection MAY use any scope.

## Comment creation and assignment

A human MAY create an annotation without assigning it. The optional `assignee`
MUST identify a human. Assignment records responsibility only: it does not
start a runtime, create a task, grant proposal-decision authority, or specify
which tools the assignee may use. Reassignment updates current portable state;
assignment history is deferred to a future event-log profile.

## Target model

A target identifies a source, a source revision, and a selector. Canonical
content uses source `document`; a projection uses its projection ID.

A comment made in a canonical view targets `document`, even when the view is
implemented with HTML. The Review Client converts the browser or native
selection into a `NodeSelector`. A comment made while viewing a separately
versioned projection targets that projection and copies its source mappings
into `canonicalTargets`. Visual similarity between the two views does not
change which object the person actually reviewed.

The selection MUST originate from the view the human actually inspected. A
natural-language description MAY supplement the comment, but it MUST NOT
replace portable semantic and quotation anchors when a precise selection is
available.

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
        "start": 15,
        "end": 39,
        "unit": "unicode-code-point"
      },
      {
        "type": "TextQuoteSelector",
        "exact": "Humans review and decide"
      }
    ]
  }
}
```

`TextPositionSelector` and `TextQuoteSelector` describe the same intended
segment using independent evidence. Position is fast but brittle. Exact text
and optional prefix/suffix provide validation and recovery after changes.

Node-level comments omit `refinedBy`.

A canonical selection crossing nodes uses `NodeRangeSelector`. Its endpoints
use node-local Unicode-code-point offsets. `exact` preserves a deterministic
canonical quote; `viewExact` MAY additionally preserve the visible text the
person selected when rendering whitespace differs:

```json
{
  "type": "NodeRangeSelector",
  "start": { "node": "node_a", "offset": 7 },
  "end": { "node": "node_c", "offset": 12 },
  "unit": "unicode-code-point",
  "exact": "canonical text\nacross nodes",
  "viewExact": "canonical text across nodes"
}
```

The start node MUST precede or equal the end node in depth-first document
reading order. When both endpoints use the same node, the start offset MUST be
less than or equal to the end offset. Each endpoint is validated against its
own node text stream.

The canonical range text is constructed in reading order from the suffix of
the start node's text stream, every non-empty intermediate node text stream,
and the prefix of the end node's text stream, joined with one U+000A LINE FEED.
Empty components are omitted. For a same-node range it is simply the selected
substring. `exact` MUST equal this canonical range text. Optional `prefix` and
`suffix` are node-local context immediately before the start offset and after
the end offset. `viewExact`, when present, records the browser or native
selection text before canonical normalization; it is provenance and MUST NOT
replace `exact` during recovery.

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
      "start": 15,
      "end": 39,
      "unit": "unicode-code-point"
    },
    {
      "type": "TextQuoteSelector",
      "exact": "Humans review and decide"
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

### Canonical HTML

A selectable canonical HTML view SHOULD emit `data-dstar-node` on the smallest
practical DOM element corresponding to each canonical node. A Review Client
converts a browser `Range` contained within one node into `NodeSelector`; a range
crossing nodes becomes `NodeRangeSelector`.

The visible text inside each mapped element MUST preserve the node text-stream
order. Whitespace introduced only for layout is not part of node offsets. A
renderer MUST store `viewExact` whenever browser whitespace normalization makes
the visible cross-node selection differ from the canonical range text.

`data-dstar-node` is a lookup aid, not an alternative identifier. The stored
target remains the node ID, document revision, node-local offsets, and quotation
evidence.

### Projection HTML

A reviewable HTML renderer SHOULD emit `data-dstar-segment` on the smallest
practical DOM elements that correspond to indexed projection segments. When a
person makes a browser selection, a Review Client:

1. obtains the browser `Range`;
2. finds the containing or intersected DSTAR segments;
3. converts the visible selection to segment-relative Unicode-code-point
   offsets and quotation evidence;
4. copies intersected `derivedFrom` relations and selectors into
   `canonicalTargets`, adding source `document` and the projection's
   `generatedFromRevision`; and
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

After an accepted canonical change or projection regeneration, a client MAY
show an old annotation in the new view only when its canonical target and
current mapping resolve exactly or unambiguously. Otherwise it MUST retain the
original target and provenance and surface the thread as `ambiguous`,
`orphaned`, or `missing-source` review work requiring confirmation.

An implementation MUST NOT silently attach a comment to different text when
the target cannot be recovered unambiguously. Resolution state is computed by
the client and does not change the annotation's stored target.

## Collaboration boundary

Annotation files are the portable snapshot of asynchronous discussion. An
implementation MAY provide live cursors, presence, notifications, access
control, or CRDT-backed synchronization, but those services do not replace the
portable thread records. DSTAR 0.1 does not define concurrent write resolution
for two tools editing the same annotation file.

## Audience

An annotation MAY declare one or more intended DSTAR actor types in `audience`.
A context projection for a particular actor type MUST omit annotations that do
not include that actor type.

Because a `.dstar` package is an inspectable file, `audience` is disclosure
metadata rather than access control. Sensitive material requires storage-level
security outside the base specification.

## Semantic validity

A semantically valid annotation MUST satisfy:

- its filename matches its `id` plus `.json`;
- all authors and lifecycle actors are valid actors;
- `assignee`, when present, identifies a human;
- the primary source and selected node, segment, or segment range exist at
  creation time;
- a projection target belongs to a projection marked `reviewable`;
- a projection target has one or more canonical targets;
- canonical targets refer to the canonical revision used to generate the
  reviewed projection;
- position selectors have `start <= end` and valid code-point boundaries;
- a node range follows canonical document reading order and has valid endpoint
  offsets, including ordered offsets when both endpoints use the same node;
- a segment range follows projection reading order;
- replies have unique IDs within the thread; and
- resolved threads include `resolvedAt` and a human `resolvedBy`; open threads
  include neither lifecycle field.
