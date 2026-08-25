# Annotations

Status: **Pre-Draft**

Annotations attach discussion or review state to a document without embedding
comment bodies in canonical content.

## Storage and thread model

Each annotation thread is stored as `annotations/<annotation-id>.json`. A
thread contains:

- a stable annotation ID;
- an annotation type;
- a primary target;
- an optional canonical target when the primary target is a projection;
- an initial body and author;
- zero or more ordered replies;
- a status and lifecycle metadata; and
- an optional intended audience.

The base annotation type is `comment`. The base statuses are `open` and
`resolved`. Every reply has its own stable ID, body, author, and timestamp.

The thread file represents current portable state. A future event-log profile
may preserve every edit, reopen, and moderation action, but snapshot and event
semantics are not mixed in `annotations/`.

## Target model

A target identifies a source, a source revision, and a selector. Canonical
content uses source `document`; a projection uses its projection ID.

The base selector is a stable node or projection-segment selector:

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
        "start": 0,
        "end": 14,
        "unit": "unicode-code-point"
      },
      {
        "type": "TextQuoteSelector",
        "exact": "Agents produce",
        "prefix": "",
        "suffix": ". Humans decide."
      }
    ]
  }
}
```

`TextPositionSelector` and `TextQuoteSelector` describe the same intended
segment using independent evidence. Position is fast but brittle. Exact text
and optional prefix/suffix provide validation and recovery after edits.

Node-level comments omit `refinedBy`.

## Projection targets

A person MAY comment on a projection rather than directly on canonical content.
The primary target then uses the projection ID, projection revision, and a
`SegmentSelector` containing a segment ID from `projections/index.json`.

Such an annotation MUST also contain `canonicalTarget`, copied from the
segment's `derivedFrom` mapping at annotation creation time. This preserves the
semantic target if the projection is later regenerated or removed. When one
projection segment derives from multiple canonical nodes, the canonical target
may select their nearest common semantic container until cross-node targets are
defined.

## Target resolution

A Review Client resolving an inline canonical target MUST:

1. locate the stable node ID;
2. try the stored position against the target revision or current text;
3. verify the selected text against `exact` when present;
4. use `exact`, `prefix`, and `suffix` to recover a moved range; and
5. report one of `exact`, `recovered`, `ambiguous`, `orphaned`, or
   `missing-source`.

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
- the primary source and selected node or segment exist at creation time;
- a projection target has a canonical target;
- position selectors have `start <= end` and valid code-point boundaries;
- replies have unique IDs within the thread; and
- resolved threads include `resolvedAt` and `resolvedBy`.
