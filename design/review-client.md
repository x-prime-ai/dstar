# Review Client

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## Purpose

The review client is the human interface for reading the canonical HTML,
creating precise discussion, assigning responsibility, inspecting candidate
changes, and making decisions. It is not a direct HTML editor.

Its primary surfaces are:

1. a sandboxed canonical document frame;
2. a review rail for comments, replies, status, and human assignee;
3. exact before/after candidate preview with DOM, CSS, and asset differences;
4. accepted version history and target-recovery status; and
5. package, source, provenance, and security diagnostics.

## Sandboxed document boundary

Canonical HTML is untrusted and never `contenteditable` in the review client.
It runs in a sandboxed frame without workspace credentials, direct filesystem
paths, arbitrary scripts, forms, popups, or remote network access.

A small trusted selection bridge may report bounded selection facts to the host
through a narrow message protocol. The host independently validates every
reported element ID, offset, and quotation against the exact package snapshot.

## Stable element identity

Every meaningful reviewable element carries a unique `data-dstar-id`. Wrapper
or decorative elements may omit it. The client never serializes DOM paths,
XPath, CSS layout positions, React keys, or transient node references as primary
identity.

```ts
interface ElementTarget {
  sourceRevision: Revision;
  element: DstarElementId;
  selector: { type: "element" };
}

interface TextTarget {
  sourceRevision: Revision;
  element: DstarElementId;
  selector: {
    type: "text-range";
    start: number;
    end: number;
    unit: "unicode-code-point";
    exact: string;
    prefix?: string;
    suffix?: string;
  };
}
```

Text offsets address the element's normalized visible text stream. Generated
CSS content is excluded and cannot carry the only meaningful copy of text.
Adapters convert browser UTF-16 offsets to Unicode code-point offsets.

## Comments and recovery

A comment records its original target and revision permanently. To display it
at another revision, the resolver proceeds conservatively:

1. resolve the same stable element ID;
2. require exact quotation at the stored range when unchanged;
3. otherwise use exact quotation plus prefix/suffix inside that element;
4. report `ambiguous` when multiple matches remain; or
5. report `orphaned` when the element or text no longer has a reliable target.

The client never silently chooses another element. Original quotation and
revision remain visible even after successful recovery.

Element comments cover layout, style, image choice, animation intent, or the
element as a whole. A future region selector may add viewport and normalized
geometry for comments on whitespace or responsive composition; it is not
required for the first milestone.

Assignment remains human responsibility metadata. Assigning a comment does not
start software, grant capabilities, or create a portable task lifecycle.

## Candidate review

The proposal surface shows:

- proposal author, request, evidence, explicit base, and candidate revision;
- sandboxed before and after frames using identical viewport settings;
- DOM changes grouped by stable element ID;
- text, attribute, class, inline style, stylesheet, and asset changes;
- stable IDs removed or replaced and comments placed at risk;
- rewrite ratio and security/accessibility diagnostics; and
- exact acceptance state and human decision.

Accept is enabled only for a fresh, applicable simulation and requires explicit
confirmation bound to the candidate revision. The UI never silently rebases a
stale proposal.

## Version inspection

Accepted history is inspection-only. Selecting a version materializes and
verifies its exact HTML, CSS, and assets before showing it. Checkpoints and
patches are storage details and are not exposed as competing document states.

The UI can compare any two materialized revisions using the same semantic diff
engine used for proposals.

## Tests

- element and text selection across Unicode, nested marks, and mixed DOM nodes;
- stable target recovery, ambiguity, and orphan behavior;
- sandbox bridge spoofing and stale snapshot rejection;
- comment, reply, assignment, and resolution persistence;
- exact before/after preview and DOM/CSS/asset diff presentation;
- warnings for removed IDs and high rewrite ratio;
- disabled stale acceptance and exact-revision human decisions;
- historical materialization labels; and
- keyboard, focus, contrast, zoom, and screen-reader behavior.
