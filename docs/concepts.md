# Core concepts

Understanding five values prevents most integration errors: document ID,
revision, state ID, revision-request ID and proposal ID. They are not
interchangeable.

## Document and package

A DSTAR document is a host-owned directory, often named `brief.dstar`. Its
accepted content is ordinary HTML, CSS and local assets; `.dstar/` contains the
review state and immutable history.

```text
brief.dstar/
├── document.html
├── styles.css
├── assets/
└── .dstar/
    ├── state.json
    └── objects/
```

The host maps its own application-level document identifier to this directory.
Never accept an arbitrary filesystem path from an API or MCP argument.

`state.id` is the DSTAR document ID stored inside the package. The reference
Viewer exposes it as `docId` in `/api/documents/:docId/...` routes.

## Candidate and accepted content

A candidate is a complete replacement file set in a separate directory. It must
contain `document.html`; CSS and supported local assets are optional. A proposal
freezes the candidate bytes but does not change accepted content. Files omitted
from the candidate are deleted if that proposal is later accepted.

There is no patch application, fuzzy merge or silent rebase. Preserve meaningful
`data-dstar-id` values on surviving elements so comment anchors remain stable.

## Revision

A revision is a deterministic `sha256:...` digest of a complete canonical file
set. It identifies document content, not mutable review metadata.

- `snapshot().revision` is the accepted revision, or `null` before the first
  proposal is accepted.
- `proposal.revision` identifies the immutable proposed content.
- `snapshot(revisionOrProposalId)` reads historical content without changing
  the accepted document.

Proposal creation requires an exact `base` revision. If accepted content changed
after the caller read it, proposal creation fails instead of rebasing.

## State ID

`stateId` is a digest of the complete review state: proposals, decisions,
comments, replies, revision requests and accepted head. Mutations such as
decision, reply, resolution and guarded request retry use an observed `stateId`
as an optimistic concurrency guard.

Read the state, let the user confirm the exact action, then submit that same
`stateId`. Do not refresh it silently after confirmation; that would change what
the user authorized.

## Proposal and decision

A proposal contains an immutable candidate revision, its exact base, a request,
an audit actor and a review diff. It starts as `pending`. An authorized caller
may explicitly `accept` or `reject` it. Acceptance changes the current files;
rejection does not.

Comments linked through `commentIds` explain what motivated a proposal. Accepting
that proposal does not automatically resolve those comments.

## Revision request

A revision request is a durable Owner instruction to prepare one proposal from
an exact accepted base. It may select several open comments, provide a general
instruction, or both. Creation freezes the selected comments, targets and
replies so later discussion does not silently change what the agent received.

The public record includes `id`, `base`, `instruction`, canonical `request`
prose, sorted `commentIds`, frozen `feedback`, `requester`, `status`, `attempt`,
optional `attemptId`, and optional `proposalId`. The lifecycle is `submitted`,
`running`, `returned`, `failed`, `expired` or `conflicted`.

`proposal.requestId` links the one returned proposal back to its request;
`proposal.motivatedBy` carries the selected comment IDs. The request's frozen
feedback and the live comment threads are both retained. The Viewer calls out
newer replies or later resolution instead of rewriting the request snapshot.

If the accepted head changes before a candidate returns, the request conflicts.
Create a new request against the new base; do not rebase the old result.
Accepting the linked proposal and resolving its comments remain separate exact
Owner actions.

## Comment target

A comment targets an exact revision and stable element ID. It may cover the whole
element or a Unicode-code-point text range.

```ts
const target = {
  revision,
  element: "risk-summary",
  selector: {
    type: "text-range",
    start: 0,
    end: 12,
    unit: "unicode-code-point",
    exact: "Launch risks",
  },
} as const;
```

When later content moves, DSTAR reports the target as `exact`, `recovered`,
`ambiguous` or `orphaned`; it never silently attaches a comment to unrelated
text.

## Actor and authorization

Core records the actor supplied by the host:

```ts
type ActorIdentity = {
  id: string;
  displayName: string;
  role: string;
};
```

`role` is an audit label. Core does not authorize it. Authentication, permission
checks and document selection must happen before calling Core or constructing an
MCP server.

## Idempotency and writers

Proposal, revision-request and MCP reply operations use host-generated
idempotency keys. Retry an uncertain operation with the same key and exactly the
same arguments. Each agent attempt has a distinct `attemptId`; only the active
attempt may return the request's proposal. New or changed work needs a new key.

The reference Viewer may run an optional trusted-host callback or issue a
short-lived external handoff. Core only persists and validates request state and
candidate files; it never invokes an agent, handles provider credentials or
promises exactly-once provider execution.

Run one writer process per package on a filesystem with reliable exclusive
creation, atomic rename and `fsync`. Multi-node and shared-filesystem writers are
not currently supported.
