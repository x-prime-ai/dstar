# Review rounds and host integration

Status: standalone review rounds implemented, 2026-09-04. Verification is
repository automation with loopback HTTP and a controlled test agent. It is not
a real provider run or external product deployment. Cross-product embedding and
provider validation are deferred, not blockers for the standalone delivery.

## Product scenario

A reviewer annotates an AI-generated report. The Owner selects three open
comments, adds a general instruction, and saves one revision request. An agent
returns a suggested version linked to the request and comments. The Owner
inspects its changes, accepts or declines it, and returns later to continue the
discussion.

Reports, proposals, design explanations and slides use the same canonical HTML,
CSS and local-asset workflow. This work does not add Markdown authority, inline
editing or another storage backend.

## Implemented contract

| Area            | Implemented behavior                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| Feedback        | Owner selects several current open threads or supplies an instruction              |
| Durable request | Core freezes exact base, instruction, comment IDs, feedback/replies and requester  |
| Agent entry     | One-attempt external handoff or optional trusted-host `agentInvocation` callback   |
| Return          | Complete candidate linked by `revisionRequest.proposalId` and `proposal.requestId` |
| Review          | Request → suggestion and comment → proposal → changes navigation                   |
| Human boundary  | Exact Owner accept/reject and separate exact comment resolution                    |
| Roles           | Reviewer can read/comment/reply but cannot request/invoke/propose/decide/resolve   |

The existing `motivatedBy` array records which selected comments motivated a
proposal. It does not prove that an agent satisfied a comment or identify an
exact changed range for every CSS/layout edit.

## Collect and save feedback

On the exact current accepted version, open comments expose **Add to request**
for an Owner. The composer accepts selected comments, a general instruction, or
both. Request creation is Owner-only and durable before either agent route
starts.

Core stores a `RevisionRequest` with:

- `id`, exact `base`, Owner `instruction`, and canonical nonempty `request`;
- sorted `commentIds` plus immutable `feedback` copies of the selected open
  comments, targets and replies;
- `requester`, `createdAt`, `updatedAt`, `status`, `attempt`, optional
  `attemptId`, optional `error`, and optional `proposalId`; and
- internal idempotency `key` and `command`, omitted from Viewer public results.

Creation requires the current accepted base. Selected comments must still be
open and resolve exactly or recoverably on that base. An identical key retry
returns the existing request; changed arguments under the key fail.

## Invoke an agent

Both routes use the same frozen request and a new random attempt ID.

- **External handoff:** Viewer creates an in-memory, 15-minute bearer resource
  with only read/propose scope. The URL contains neither Owner nor Reviewer
  credentials. Expiration or revocation records `expired` without erasing the
  request.
- **Trusted-host callback:** `startViewer({agentInvocation})` passes the public
  request and exact encoded base files to a host function with an `AbortSignal`.
  The callback returns one complete encoded candidate. The configured timeout
  is 100–300000 ms; the default is 60 seconds.

The host owns provider configuration, credentials, execution, billing and
process durability. Core persists request/attempt state and validates candidates;
it never invokes an agent.

Request states are `submitted`, `running`, `returned`, `failed`, `expired` and
`conflicted`. `attempt` increases for each handoff or host retry, while
`attemptId` identifies the only attempt allowed to return. An identical active
invoke reconciles to existing durable state. A new attempt supersedes an old
failed/expired attempt. Returned requests are terminal.

Viewer restart cannot resume its in-memory executor: it reconciles a running
host attempt to `failed` and an issued external handoff to `expired`, preserving
the request and frozen feedback for explicit retry.

This limits duplicate stored proposals, not duplicate provider execution or
charges after an ambiguous timeout. Callers refresh durable state before retrying
and use a new attempt ID only when starting a new execution.

## Return and review a suggestion

The agent returns a complete HTML/CSS/assets candidate, not a patch. Core
requires the request's exact `base`, canonical `request`, sorted `commentIds`,
`requestId`, current `attemptId`, and prescribed attempt-scoped key. It stores
the proposal and request link atomically. The proposal remains pending; no agent
route can accept, reject or resolve.

The request card opens its returned suggestion. A comment lists linked proposals;
opening one focuses that relationship. **View linked changes** uses
`document.html` when the structured diff names the comment's target element.
Otherwise Viewer explains that no exact local mapping exists and opens the
available file or full Before/After comparison.

Acceptance is still an explicit Owner decision against the exact ready After
preview, proposal revision and current review-state hash. Reject is also explicit.
Accepting or rejecting never resolves a comment; resolution is a separate Owner
action with its own current state check.

## Changes while an agent works

- **Accepted head changes:** the request becomes `conflicted`; an old result
  cannot become a current proposal. The Owner creates a new request against the
  new head. There is no silent rebase.
- **Discussion changes:** the submitted feedback remains unchanged. Viewer
  compares it with live comments and labels newer discussion.
- **Selected comment resolves:** the request still shows the frozen open-comment
  snapshot, but proposal return fails closed and the request conflicts instead
  of dropping that comment.
- **Timeout or invalid candidate:** the request records a bounded failure code
  and remains available for a new attempt.
- **Late or duplicate result:** only the active attempt may return; an already
  returned request reconciles to its existing proposal.

## Evidence and remaining work

Automated Core tests cover durable reopen, frozen feedback, state validation,
attempt transitions, stale/superseded attempts, proposal linkage and
idempotency. Viewer tests cover Owner/Reviewer boundaries, batch external
handoff, exact scoped return, timeout/retry and a controlled host callback. UI
unit tests cover request composition, status, drift labels and
comment-to-change destination selection.

This evidence completes the standalone review-round delivery at repository-test
level. No real model provider, production external-host deployment, native
provider browser workflow, billing behavior or provider work continuation
across process restart has been validated.

A future cross-product study may embed or mount the review experience in an
external product at its own origin and record setup work, adapter code and time
to a first accepted revision. That study is explicitly deferred. It must not be
reported as already completed or used to hold the standalone runtime open. The
filesystem package remains the current storage contract; a generic storage
abstraction is out of scope.

## Deferred choices

Direct inline edits need an attributed revision workflow. Canonical Markdown
needs renderer/source mapping and writeback semantics. Neither is part of this
review-round implementation. Do not add a second document schema, universal
agent orchestration layer or storage backend as speculative follow-up work.

## Reference

[MikoMarkup's integration design](https://github.com/snowan/miko-markup/blob/0b46f04ec5b8166b13ca4c4ae2f5529efe9fc4e9/docs/integration.md)
informed the batch-feedback workflow and small host callback boundary. DSTAR
uses those ideas with durable review context and its exact revision model.
