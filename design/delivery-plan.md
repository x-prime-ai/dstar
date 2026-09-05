# Review-round delivery plan

Status: DSTAR standalone delivery implemented and verified by automated
repository tests, 2026-09-04. Verification uses real Core persistence, loopback
Viewer HTTP, clean packed-package imports and a controlled test agent. It does
not claim a real model provider or production external-host deployment; those
are deferred cross-product evidence.

## Current delivery batch: embedding readiness and inspection

Status: repository scope implemented, verified and independently reviewed,
2026-09-04. This batch begins from integrated commit `d8c99b5`. It does not
reopen the completed request lifecycle or host-agent callback work, and it does
not claim deferred external-host/provider evidence.

The independently executable DSTAR scope is:

- turn the existing `basePath` support into a smallest-working mount contract
  with a host-facing health/readiness check and an integration checklist;
- reduce Before / After and comment-to-change review friction, especially when
  an anchor is missing or the only observable changes are CSS/layout or assets;
- verify the same tasks with keyboard-only operation and at a 390 px viewport;
  and
- keep exact revision, request-attempt, Owner-decision, comment-resolution and
  iframe isolation boundaries unchanged.

Cross-product repository inspection, existing user data and live provider calls
are outside this batch. Repository fixtures, controlled callbacks and mount
examples are standalone integration-contract evidence only.

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
- Packed Core/MCP/Viewer entry-point smoke from a clean consumer layout, with
  MCP request/proposal linkage projected through the public adapter.

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

Repository test success is sufficient to mark the standalone implementation
delivery verified. It is not sufficient to claim real provider behavior, billing
deduplication, production process recovery, native browser/provider integration,
container/TLS deployment or external-product validation.

For the embedding-readiness and inspection batch, the final repository suite
passed with 73 Core, 181 Viewer, 1 MCP, 2 example-library, 11 workspace and 1
TypeScript-host test. A fresh Chromium session at 390×844 independently
confirmed that ambiguous and orphaned threads remain visible and focusable,
only exact/recovered feedback can enter a revision request, the narrow drawer
uses non-modal semantics, and the page has no horizontal overflow. This is
controlled-fixture evidence, not external-product evidence.

## Deferred cross-product evidence

A future integration may mount the review experience in an external product at
its own origin, with its identity, filesystem package and provider invocation,
then record setup work, adapter code, deployment constraints and time to first
accepted revision. That evidence would support claims about that integration
or a reusable overlay package; it is not missing standalone delivery work.

Further comment-to-change navigation should follow observed review friction. A
structured motivation link is not proof that every selected comment was
satisfied, especially for CSS/layout changes.

## Release handoff

Before merging, rerun the relevant workspace tests, formatting/link checks,
packed-package consumer smoke and the repository verification suite where the
environment permits. Record failed or unavailable checks accurately. The final
merge/commit is owned by the delivery lead; this plan does not itself claim a
deployment or provider run.
