# Core TypeScript SDK

`@dstar/core` is the complete server-side API for one filesystem-backed DSTAR
document. It does not make network calls and does not know about product roles,
MCP or WebMCP.

## Install

The package requires Node.js 22 or newer and ESM. When consuming a published
release, pin its exact pre-1.0 version:

```sh
pnpm add @dstar/core@0.1.0
```

Inside this repository, `pnpm install && pnpm build` links the workspace package.

## Open a document

```ts
import { openDocument, type ActorIdentity } from "@dstar/core";

const actor: ActorIdentity = {
  id: session.user.id,
  displayName: session.user.name,
  role: session.user.role,
};

const document = openDocument(`/srv/dstar/${trustedDocumentKey}.dstar`);
const current = document.snapshot();

console.log(current.state.id); // DSTAR document ID
console.log(current.stateId); // exact mutable review-state digest
console.log(current.revision); // accepted content revision, or null
```

Resolve `trustedDocumentKey` through host-owned metadata. Never construct a
package path from an unchecked request or tool argument.

## Propose a complete candidate

The candidate is a separate complete directory, not a patch:

```ts
const proposal = document.propose({
  candidate: "/srv/staging/request-123",
  base: current.revision,
  request: "Make the launch risks explicit",
  author: actor,
  key: "request-123",
});

console.log(proposal.id, proposal.revision, proposal.status);
```

The candidate must contain `document.html`, with optional `styles.css`,
`styles/**/*.css` and supported local files under `assets/`. Proposal creation
validates and freezes those bytes, calculates the diff and stores history. The
accepted checkout remains unchanged until an explicit acceptance.

If `base` is stale, read a new snapshot and prepare a new candidate and key.
Never relabel an old candidate as based on newer content.

## Create and run a durable revision request

Core can freeze an Owner instruction and selected open feedback before a host
starts an agent:

```ts
const request = document.createRevisionRequest({
  base: current.revision,
  instruction: "Address the selected feedback and keep the tone direct.",
  commentIds: [firstComment.id, secondComment.id],
  requester: owner,
  key: "revision-request-123",
});

const attemptId = crypto.randomUUID();
const running = document.updateRevisionRequest(request.id, {
  status: "running",
  attemptId,
});
```

`createRevisionRequest` sorts and validates the comment IDs, requires the exact
accepted base, and copies each selected open comment, target and current replies
into immutable `feedback`. An instruction-only request is valid; an empty
request is not. An exact create retry returns the stored request.

The integrating host—not Core—invokes the agent. After receiving a complete
candidate, link it atomically to the active request attempt:

```ts
const linked = document.propose({
  candidate: "/srv/staging/revision-request-123",
  base: running.base,
  request: running.request,
  commentIds: running.commentIds,
  requestId: running.id,
  attemptId,
  author: agentIdentity,
  key: `revision-request:${running.id}:${attemptId}`,
});
```

Core verifies the exact base, canonical request prose, comment links and current
attempt, then sets the request to `returned` with `proposalId` and adds the
reciprocal `proposal.requestId`. Use `updateRevisionRequest` to record
`submitted`, `running`, `failed`, `expired` or `conflicted`; `returned` is set
only by a linked `propose`. A timeout or uncertain provider response may mean
the provider ran even though no proposal was stored. Reconcile durable state
before starting a distinct attempt.

## Read current and historical content

```ts
const accepted = document.snapshot();
const proposed = document.snapshot(proposal.id);
const exactRevision = document.snapshot(proposal.revision);

for (const [path, bytes] of exactRevision.files) {
  console.log(path, bytes.length);
}
```

The optional reference may be a proposal ID or exact revision. Reads validate
stored history before returning it.

## Add a comment

```ts
import type { Target } from "@dstar/core";

const target: Target = {
  revision: proposal.revision,
  element: "risk-summary",
  selector: {
    type: "text-range",
    start: 0,
    end: 12,
    unit: "unicode-code-point",
    exact: "Launch risks",
  },
};

const comment = document.comment({
  target,
  body: "Can we quantify this risk?",
  author: actor,
});
```

Use `{type: "element"}` to target a whole element. Targets always name an exact
revision and stable `data-dstar-id`.

## Reply with exact-state and idempotency checks

```ts
const observed = document.snapshot();

const thread = document.reply(
  comment.id,
  "Added supporting metrics in the pending version.",
  actor,
  "reply-request-456",
  observed.stateId,
);
```

If the result is uncertain, retry with the same key and exactly the same
arguments. A different body, comment or actor requires a new key. A new reply
should use the latest state observed before the action was authorized.

## Accept or reject a proposal

```ts
const observed = document.snapshot();

const decided = document.decide(
  proposal.id,
  "accept", // or "reject"
  proposal.revision,
  observed.stateId,
  actor,
);
```

The host must authenticate and authorize this action before calling Core. Both
the expected revision and state ID are required so concurrent changes fail
closed.

## Resolve a comment

```ts
const observed = document.snapshot();

document.resolveComment(comment.id, observed.stateId, actor);
```

Resolution is independent from proposal acceptance. A product may require a
different permission for each operation.

## Export a revision

```ts
document.export("/srv/exports/request-789", proposal.revision);
```

Export into an empty destination. Omit the revision to export accepted content.

## Public API

| API                                                    | Purpose                                            |
| ------------------------------------------------------ | -------------------------------------------------- |
| `openDocument(root)`                                   | Open the complete document API                     |
| `snapshot(reference?)`                                 | Read current state or immutable historical content |
| `propose(input)`                                       | Persist a complete candidate for review            |
| `createRevisionRequest(input)`                         | Freeze an exact batch request and feedback         |
| `updateRevisionRequest(requestId, input)`              | Advance or retry one invocation attempt            |
| `comment(input)`                                       | Create a comment on an exact target                |
| `reply(commentId, body, actor, key?, stateId?)`        | Add a reply                                        |
| `decide(proposalId, action, revision, stateId, actor)` | Accept or reject                                   |
| `resolveComment(commentId, stateId, actor?)`           | Resolve a thread                                   |
| `export(directory, reference?)`                        | Materialize a file set                             |
| `readCandidate(directory)`                             | Read and validate candidate files                  |
| `validateHtml(files)`                                  | Validate in-memory canonical files                 |
| `revision(files)`                                      | Calculate a deterministic content revision         |
| `validateTarget`, `resolveTarget`                      | Validate and locate comment targets                |

All public types are exported from the package root. See the
[implemented format and limits](../design/html-mvp.md) for supported HTML,
assets, storage and recovery behavior.

## Host responsibilities

- Authenticate before opening or mutating a document.
- Map application document IDs to trusted package paths.
- Authorize each operation; Core does not interpret `actor.role`.
- Keep agent execution, provider credentials, timeouts and cancellation in the
  trusted host; Core never starts an agent.
- Generate idempotency keys outside untrusted model output where practical.
- Run one writer process per package.
- Back up the complete package while writers are stopped.
- Pin the pre-1.0 package version and test upgrades on copied data.
