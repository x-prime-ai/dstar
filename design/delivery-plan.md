# Review-round delivery plan

Status: implemented and verified by automated repository tests, 2026-09-04.
This status applies to roadmap milestones 1 and 2 only. Verification uses real
Core persistence, loopback Viewer HTTP and a controlled test agent; it does not
claim a real model provider, production host deployment or completed milestone 3.

## Current delivery batch: embedding readiness and inspection

Status: in progress, 2026-09-04. This batch begins from integrated commit
`d8c99b5`. It does not reopen the completed request lifecycle or host-agent
callback work.

The independently executable DSTAR scope is:

- turn the existing `basePath` support into a smallest-working mount contract
  with a host-facing health/readiness check and an integration checklist;
- reduce Before / After and comment-to-change review friction, especially when
  an anchor is missing or the only observable changes are CSS/layout or assets;
- verify the same tasks with keyboard-only operation and at a 390 px viewport;
  and
- keep exact revision, request-attempt, Owner-decision, comment-resolution and
  iframe isolation boundaries unchanged.

A read-only xPrime inspection may inform a minimal real-host adapter plan. It
does not authorize changes to xPrime, use of its existing user data, or a live
provider call. Milestone 3 remains incomplete unless a selected real host runs
two rounds at its own origin with host-owned identity, data and provider
execution. Repository fixtures, controlled callbacks and mount examples remain
embedding-readiness evidence only.

## Delivered scope

- A durable `RevisionRequest` collection in `records-v1`, including exact base,
  Owner instruction, canonical request prose, selected comment IDs, frozen
  feedback/replies, requester, lifecycle status, attempt identity and linked
  proposal ID.
- Public Core `createRevisionRequest` and `updateRevisionRequest` APIs plus
  request-linked `propose` inputs and reciprocal `proposal.requestId`.
- Owner-only Viewer request and host-invoke routes, a batch external handoff,
  and the optional trusted-host `agentInvocation` callback.
- Retry, timeout, expiration, conflict, late-result and idempotency behavior at
  the durable request/attempt boundary.
- UI status/drift disclosure and basic request → proposal and comment → proposal
  → changes navigation.
- Public SDK, HTTP, Viewer, storage-format and design documentation.

The delivery retains complete static HTML/CSS/local-asset candidates, the
filesystem package and the exact Owner decision boundary. It does not add
Markdown authority, direct inline editing, a generic storage backend or provider
orchestration inside Core.

## Verified behavior

The current automated suites cover:

- request creation, reopen, frozen feedback and corrupt-record rejection;
- exact create/propose idempotency and reciprocal request/proposal linkage;
- attempt transitions, timeout, retry, superseded attempts and stale-base
  conflict;
- external-handoff scope and exact batch proposal return;
- optional host callback success using a controlled agent and callback timeout;
- Owner/Reviewer request/invoke restrictions;
- discussion/reply drift and later comment resolution while preserving the
  submitted snapshot;
- explicit proposal accept/reject with comment resolution unchanged; and
- request/comment/proposal/change navigation helpers.

Repository test success is sufficient to mark this implementation delivery
verified. It is not sufficient to claim real provider behavior, billing
deduplication, production process recovery, native browser/provider integration,
container/TLS deployment or real-host embedding.

## Remaining delivery

Roadmap milestone 3 remains open: mount or embed the review experience in one
real host at its own origin, with host-owned identity, filesystem package and
provider invocation. Complete two review rounds and record setup work, adapter
code, deployment constraints and time to first accepted revision. Only that
evidence can mark real-host embedding complete or justify a reusable overlay
package.

Further comment-to-change navigation should follow observed real-host review
friction. A structured motivation link is not proof that every selected comment
was satisfied, especially for CSS/layout changes.

## Handoff

Before merging, rerun the relevant workspace tests, formatting/link checks and
the repository verification suite where the environment permits. Record failed
or unavailable checks accurately. The final merge/commit is owned by the delivery
lead; this plan does not itself claim a commit, deployment or provider run.
