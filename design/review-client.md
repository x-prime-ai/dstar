# Review Client

Status: **Draft**

## 1. Purpose

The review client is the human interface for reading, precise discussion,
delegation, and decisions. It is deliberately not a canonical rich-text editor.

The client must make these actions fast without weakening protocol boundaries:

- read a canonical view or stored projection;
- select text or a semantic object;
- create a portable comment;
- discuss or resolve the thread;
- explicitly delegate it to an agent;
- inspect a deterministic proposal simulation; and
- accept, reject, supersede, or request a new proposal.

## 2. Application surfaces

The first browser application has five primary surfaces:

1. **Reader** — canonical view or selected projection.
2. **Review rail** — comments at the current location plus unresolved review
   inbox.
3. **Agent activity** — delegations and local execution status.
4. **Proposal review** — semantic operation list, before/after view, conflicts,
   provenance, and decision controls.
5. **Document inspector** — manifest, profiles, sources, revisions, diagnostics,
   and projection freshness.

Navigation keeps one selected document object in the URL where possible:

```text
/document?node=node_promise
/projection/projection_html?segment=segment_html_promise
/annotation/ann_0001
/change/change_0001
```

These are application URLs, not portable identifiers.

## 3. Read-only authoring boundary

Canonical and projection content is never `contenteditable`. The client does not
offer formatting toolbars, direct text insertion, drag-to-reorder, paste into
content, or editor transactions.

Keyboard input while the reader is focused may:

- open comment or command controls;
- search and navigate;
- copy selected content; or
- provide agent direction in a separate form.

It must not directly change rendered document content. Even a typo action
creates a `change-request` annotation or direct agent request followed by a
proposal.

## 4. View adapters

All displayed content is accessed through a `ReviewableViewAdapter`:

```ts
interface ReviewableViewAdapter {
  source(): "document" | ProjectionId;
  sourceRevision(): Revision;
  captureSelection(range: Range): SelectionCaptureResult;
  revealTarget(target: Target): RevealResult;
  currentText(target: Target): string | undefined;
}
```

The canonical adapter creates node selectors directly. A projection adapter
creates segment selectors and copies source mappings into canonical targets.
Transient DOM references never leave the adapter.

## 5. Canonical DOM contract

The canonical renderer returns safe DOM plus an in-memory `CanonicalDomMap`.

### 5.1 Elements

The smallest practical element for each semantic node contains:

```html
<p data-dstar-node="node_promise">...</p>
```

Nested semantic nodes receive their own element. Decorative wrappers do not
carry node IDs. Node IDs are escaped as attribute values and are looked up in
the snapshot index before use.

### 5.2 Text-run map

The renderer registers every DOM `Text` node that represents canonical inline
text:

```ts
interface CanonicalTextRun {
  domText: Text;
  nodeId: NodeId;
  inlineIndex: number;
  canonicalStart: number; // Unicode code points
  canonicalEnd: number;
  domUtf16Start: number;
  domUtf16End: number;
}
```

Text inserted for layout, list decoration, generated labels, fallback controls,
or CSS is not registered as canonical text. Marks may split DOM text nodes but
their registered canonical intervals remain contiguous.

The client converts DOM UTF-16 offsets to Unicode-code-point offsets using the
actual run text. It refuses boundaries that cannot be associated with a
registered run or semantic object.

### 5.3 Images and non-text objects

Clicking a leaf object such as an image creates a node-level `NodeSelector`.
Dragging across it may produce a `NodeRangeSelector` whose canonical quote
omits empty text components while `viewExact` retains visible accessible text
when the browser included it.

## 6. Canonical selection algorithm

Given a browser `Range`:

1. Reject a collapsed selection for inline comments; object comments use an
   explicit object action.
2. Find registered text runs or semantic elements at both endpoints.
3. Convert endpoint UTF-16 offsets to node-local Unicode-code-point offsets.
4. If both endpoints belong to one node, create `NodeSelector` refined by one
   position and one quote selector.
5. If endpoints belong to different nodes, order them by canonical reading
   order and create `NodeRangeSelector`.
6. Compute `exact`, `prefix`, and `suffix` from canonical node text streams.
7. Compute browser-visible selection text; store `viewExact` when it differs
   from canonical LF normalization.
8. Verify the target against the snapshot document revision.
9. Show a comment composer only after verification succeeds.

A visually reversed drag is normalized using `Range` start/end, but a selection
whose semantic endpoints are reversed by unusual DOM layout is rejected rather
than silently reordered against document meaning.

## 7. Projection DOM contract

Stored HTML projections are sanitized and displayed in an iframe with scripts,
forms, popups, and top navigation disabled. The parent retains DOM access only
to the sanitized same-origin document needed for selection capture.

Every selectable meaningful region must be contained in an indexed element:

```html
<p data-dstar-segment="segment_html_promise">...</p>
```

The projection adapter builds a `SegmentDomMap` from the validated index and
actual DOM. Duplicate, missing, or unindexed segment attributes make the
affected region non-reviewable and produce a diagnostic.

## 8. Projection selection algorithm

1. Capture the browser `Range` inside the projection frame.
2. Identify all intersected mapped segments in index reading order.
3. Reject selection containing meaningful content outside those segments.
4. Convert endpoints to segment-visible Unicode-code-point offsets using a
   renderer-generated or reconstructed text-run map.
5. Store `SegmentSelector` for one segment or `SegmentRangeSelector` for more.
6. Preserve exact visible quotation and local prefix/suffix where available.
7. Copy each intersected `derivedFrom` relation and canonical selector into an
   annotation canonical target with source `document` and the projection's
   `generatedFromRevision`.
8. Deduplicate byte-equivalent canonical targets while preserving mapping order.
9. Verify projection revision and mappings immediately before annotation write.

For `transformed` and `summarizes` mappings, the client never narrows the
canonical selector based on model inference or similar text.

## 9. Comment creation

The composer requires:

- non-empty body;
- purpose: discussion, question, or change request;
- scope allowed by the primary target;
- human actor; and
- optional audience.

The command carries the complete target values, not DOM coordinates:

```ts
interface CreateAnnotationCommand {
  expectedSnapshotId: SnapshotId;
  idempotencyKey: string;
  author: HumanActor;
  purpose: AnnotationPurpose;
  scope: AnnotationScope;
  target: Target;
  canonicalTargets?: CanonicalTarget[];
  body: string;
  audience?: ActorType[];
}
```

After write, the client reveals the stored target from the returned snapshot.
If it cannot resolve, creation is treated as failed even if an optimistic UI
briefly displayed the thread.

## 10. Thread lifecycle

### Replies

Humans may reply directly. Agent replies are written through the agent runtime.
Reply order is serialized array order; a stale annotation file hash prevents
overwriting a concurrent reply.

### Resolve

Only a human action can resolve a thread in 0.1. Resolution records actor and
time but does not cancel delegations, decide proposals, or delete anchors.

The current spec has no reopen representation. The reference UI does not offer
reopen until the spec defines whether it mutates snapshot history or creates a
new thread.

### Review inbox

The inbox groups open threads by computed resolution:

- exact/recovered;
- ambiguous;
- orphaned;
- missing source; and
- projection stale or unavailable.

Resolution labels are computed read models and are not written into annotation
files.

## 11. Delegation UX

Delegation is a separate button in a thread. The dialog shows:

- anchored selection and canonical mappings;
- assignee and capability summary;
- optional supplemental instruction;
- source/audience information visible to that agent; and
- estimated provider limits when available.

Submitting creates a portable queued delegation first. Agent execution starts
only after the service returns the new snapshot. Duplicate clicks use the same
command idempotency key.

The client displays local execution detail without confusing it with portable
delegation status. Cancelling requires confirmation and creates a portable
terminal transition.

## 12. Target resolution and display

For every thread, the client asks the core resolver for:

```ts
type Resolution =
  | { state: "exact"; target: CurrentTarget }
  | { state: "recovered"; target: CurrentTarget; method: "quote-context" }
  | { state: "ambiguous"; candidates: CurrentTarget[] }
  | { state: "orphaned" }
  | { state: "missing-source" };
```

Only exact and unique recovered targets receive inline highlights. Ambiguous
candidates may be previewed in the inbox, but the client does not persist a new
anchor without a future explicit protocol action.

Highlights use overlay ranges or non-semantic wrappers that do not change the
registered DOM text map. Multiple overlapping comments are rendered as one
visual band with individual threads in the rail.

## 13. Proposal review

The proposal page is driven entirely by `ChangeApplier.simulate` and contains:

- author, creation time, bases, motivations, delegation, and sources;
- ordered operations in semantic language;
- affected node hierarchy;
- before and simulated-after canonical render;
- inline textual and attribute differences;
- inserted, deleted, and moved object summaries;
- profile/validation diagnostics;
- current applicability: applicable, stale base, local conflict, or invalid;
- expected result revision; and
- decision controls available to the current human actor.

The UI does not render an arbitrary patch supplied by the model. It renders the
deterministic simulation output.

### Decisions

- **Accept** is enabled only for an applicable proposal and requires a fresh
  snapshot check.
- **Reject** requires an optional reason and does not resolve its comment.
- **Supersede** identifies the proposal as obsolete but does not itself create
  the replacement.
- **Request rebase** starts a new agent job; it does not mutate the stale
  proposal.

Acceptance has a final confirmation that names the agent author, human decision
actor, affected semantic objects, and resulting revision.

## 14. Historical canonical versions

A history panel lists accepted changes from genesis to head. Each entry shows
the accepted change ID, agent author, human decision actor and time, motivation,
and result revision. Repeated content revisions remain separate entries.

Opening an entry requests a verified materialization from the version service
and renders it with the same semantic/profile renderer used for current
content. A persistent banner names the accepted change and revision and states
that this is historical canonical content, not the current document.

The 0.1 historical view is inspection-only: comment, delegation, proposal
decision, and projection-regeneration controls are disabled. It may link to
current collaboration objects, but it does not overlay them as if they
represented historical package state. If materialization or revision
verification fails, the client shows the history diagnostic and never
substitutes current content.

## 15. Projection freshness

The client compares every projection's `generatedFromRevision` with the current
manifest revision.

- Current projection: normal review and comment controls.
- Stale projection retained for provenance: readable with a prominent stale
  label; new comments are disabled by default because they would target an old
  view, but an advanced explicit action may allow it.
- Missing artifact with retained metadata: show quotation/mapping in the thread
  inspector, not a fabricated view.
- Regeneration failure: canonical view remains available.

## 16. Accessibility

- Canonical and projection content preserve semantic headings, lists, tables,
  figures, code, and alternative text.
- Comment anchors are reachable by keyboard and announced with thread counts.
- Selection is not the only way to comment: every semantic object has a
  keyboard-accessible “comment on object” action.
- Proposal diffs have a linear text representation in addition to color.
- Agent activity never relies on animation alone.
- Focus returns to the originating anchor after comment/delegation commands.
- Historical views announce their version identity and non-current state before
  the document content.

## 17. Client state and caching

Durable state always comes from service snapshots. Browser state contains:

- current route, scroll position, and expanded panels;
- transient `Range` and draft comment text;
- optimistic command status;
- cached safe view models keyed by snapshot ID; and
- user display preferences.

Draft comment text may be saved locally but is never inserted into a package
until the user submits it. A snapshot invalidation clears selections and
proposal simulations but may retain the draft body with a “reselect target”
warning.

## 18. Tiptap boundary

Tiptap is not required for 0.1 because there is no direct editing surface. If a
future adapter uses Tiptap or ProseMirror for rendering, collaboration, or
selection conveniences:

- DSTAR nodes remain the input and source of identity;
- ProseMirror positions are transient;
- all selections convert through `ReviewableViewAdapter`;
- Tiptap JSON is neither stored nor accepted as a change operation; and
- editor transactions cannot bypass agent proposal and human decision flows.

## 19. Tests

- DOM text-run fixtures for marks, Unicode astral characters, combining marks,
  and nested elements.
- Canonical and projection selection tests within and across nodes/segments.
- Browser whitespace tests verifying `exact` versus `viewExact`.
- Unmapped/duplicate/malicious segment tests.
- Comment scope/purpose and independent delegation lifecycle tests.
- Target recovery tests for exact, recovered, ambiguous, orphaned, and missing.
- Proposal-review tests proving displayed results come from simulation.
- Historical-version list, materialization failure, repeated revision, and
  current-state labeling tests.
- Keyboard and screen-reader interaction tests.
- End-to-end refresh tests proving no durable state depends on browser memory.
