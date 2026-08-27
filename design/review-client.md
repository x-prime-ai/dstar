# Review Client

Status: **Draft**

## Purpose

The review client is the human interface for reading, precise discussion,
human assignment, proposal inspection, and decisions. It is not a canonical
rich-text editor.

Its primary surfaces are:

1. a canonical or projection reader;
2. a review rail for comments, replies, status, and human assignee;
3. proposal review with deterministic before/after output and conflicts; and
4. an inspector for manifest, profiles, sources, revisions, and diagnostics.

There is no executor, task, or run-status surface. A person may use any external
tool to help with an assigned comment, but that activity is outside DSTAR.

## Read-only content boundary

Canonical and projection content is never `contenteditable`. Selection,
navigation, copying, and comment composition cannot mutate canonical content.
Any content change arrives as a pending proposal and requires a separate human
decision.

All displayed content uses a view adapter:

```ts
interface ReviewableViewAdapter {
  source(): "document" | ProjectionId;
  sourceRevision(): Revision;
  captureSelection(range: Range): SelectionCaptureResult;
  revealTarget(target: Target): RevealResult;
  currentText(target: Target): string | undefined;
}
```

The canonical renderer maps semantic elements with `data-dstar-node` and keeps
an in-memory DOM-text-run map from UTF-16 browser offsets to canonical Unicode
code-point offsets. Projection selection uses validated `data-dstar-segment`
markers and copies source mappings into canonical targets. Transient DOM
references are never serialized.

Selection capture verifies exact text, prefix/suffix context, source revision,
and target resolution before opening a composer. Unsupported, mixed, stale, or
unmapped selections fail visibly instead of producing approximate portable
anchors.

## Comments and human assignment

Creating a comment records purpose, scope, target, redundant canonical targets,
body, human author, optional human assignee, and open status. Replies and
resolution are explicit commands. Resolution requires a human actor.

Assignment is only workflow metadata about accountable people:

```ts
annotation.assignee?: HumanActor
```

Assigning or reassigning does not start work, invoke software, grant a
capability, or create another portable object.

## Proposal review

The proposal view shows author, time, explicit bases, motivations, sources,
ordered operations, diagnostics, semantic diff, and computed result revision.
Accept is enabled only for a fresh, applicable simulation and requires explicit
human confirmation bound to that result revision. Reject and supersede are
separate human decisions. Stale proposals cannot be rebased by the UI; a new
proposal must be submitted against new bases.

Accepted-version history is inspection-only. It materializes canonical content
from the accepted chain and labels any present-day collaboration metadata as
current.

## Service contract

The browser uses the loopback workspace service with a session token and fresh
snapshot IDs. It may create/reply/resolve/assign annotations and perform human
proposal decisions. MCP is a separate proposal-only boundary and is never used
by the browser to smuggle canonical decisions.

## Tests

- canonical and projection selection, including Unicode and stale mappings;
- comment creation, reply, resolution, and human-only assignment;
- no task/executor controls or direct content editing;
- deterministic proposal simulation and disabled stale acceptance;
- exact-revision human decisions; and
- keyboard, focus, contrast, zoom, and screen-reader behavior.
