# Reference architecture

Status: implemented host-owned MVP; development format with a pre-stable public
SDK surface.

This architecture supports the multi-round document review experience in the
[Vision](../VISION.md). Durable batch requests, scoped external handoff and the
optional trusted-host agent callback are implemented. The
[review-round design](review-rounds.md) specifies those contracts and the still
unimplemented real-host embedding milestone. Core continues to own revisions;
the host owns agent execution. See the [roadmap](roadmap.md) for sequencing.

## Responsibilities

```text
MCP client ──> host MCP transport ──> @dstar/mcp ──┐
                                                   ├──> @dstar/core
product UI / reference Viewer ──> optional host agent ───────┤
                           │                                 │
                           └──> scoped external handoff ─────┘
                                                             ▼
                                                   host-owned directory
```

Core is independent of MCP and the Viewer. Its proposal operation derives and
stores candidate revision, compact byte deltas and review summaries immediately.
A Viewer is not needed to prepare a proposal or reconstruct historical HTML.

The Viewer does not calculate or own versions. Its local server reads immutable
materializations and submits attributed collaboration or Owner decision commands
to the Engine. Its centralized role gate gives Reviewer read/comment/reply/
handoff capabilities. Revision request creation/invocation, document proposals,
decisions and resolution are Owner-only.
`@dstar/mcp` does not own versions either: it validates protocol inputs, exposes
only host-selected capabilities and invokes Core. The integrating product owns
the MCP transport, authentication, process and package directory.

## Code

- `packages/core`: file inventory, HTML/CSS validation, hashes, byte deltas,
  materialization, comments, proposals and locked/journaled writes.
- `packages/core/src/cli.ts`: validate, inspect, export, propose, comment, reply.
- `packages/mcp`: MCP server/tool adapter over the complete Core API.
- `apps/viewer`: loopback HTTP adapter and static browser UI.
- `scripts/dstar.mjs`: repository launcher, including `serve`.
- `skills/dstar-documents`: agent operating instructions and format references.

## Directory storage

The portable artifact remains an ordinary directory, with no SQLite or Git
runtime requirement. A small `.dstar/state.json` commits the head, generation
and counts of separately stored proposal, comment-thread and revision-request
JSON records.
Compressed content objects and exact-byte delta encodings remain unchanged.
The Engine assembles the same logical JSON view for CLI/Viewer consumers.

An undo journal protects cross-record metadata writes; the small state header is
the commit point. Metadata recovery precedes checkout recovery. Acceptance writes
only changed canonical paths, and each locked operation reuses its verified head
instead of replaying it twice. Monolithic HTML-first metadata is read as-is and
converted on its next real mutation. See [the storage contract](html-mvp.md) for
layout, compatibility, limits and crash recovery.

The Viewer verifies a snapshot when issuing a preview capability and serves its
HTML/CSS/assets from a bounded in-memory cache. It does not cache mutable review
state or use preview bytes as authority for decisions; those requests still run
the Engine's current-state, role/capability and history checks.

## Authoring and proposal

The agent edits a full candidate directory separate from the accepted package.
The Engine compares it with the exact inspected base, rejects unsafe or stale
input, preserves raw canonical bytes, computes file/object hashes and selects
delta or replacement storage. It records a pending proposal with bounded
stable-ID review summaries. The accepted checkout and head remain unchanged.

The candidate can be viewed directly from its immutable storage objects.
Subsequent changes to the agent's staging directory do not change the proposal.

## Revision request and invocation

An Owner creates a durable request against the exact accepted revision. Core
freezes the instruction, selected open comment IDs and their feedback/reply
snapshot before any invocation. The request's latest `attemptId` is a
compare-and-set boundary for either a 15-minute external handoff or the Viewer's
optional trusted-host callback. Core never calls a provider or receives model
credentials.

Both invocation routes must return one complete candidate using the request's
exact base, canonical request prose and comment set. `propose` stores the one
linked proposal and atomically sets `revisionRequest.proposalId` and
`proposal.requestId`. A provider timeout can be recorded and retried, but DSTAR
does not claim exactly-once provider execution. Accepted-head drift conflicts
the request; it is never silently rebased.

## Decisions

The Viewer presents this as a Suggested change with Before / After and Changes,
then opens an explicit confirmation dialog. Revision and base hashes remain in
expandable technical details instead of primary navigation. Acceptance still
supplies proposal ID, candidate hash and current state hash. Under a write lock
the Engine verifies all three, checks the exact parent is still head and
materializes/verifies the stored candidate. It journals checkout paths,
installs files, and atomically switches the authoritative state last.

Reject records a decision without changing canonical files. Owner resolution
changes only comment state. The deciding/resolving actor is persisted. The
filesystem is trusted; these are workflow/API
boundaries, not protection against a local process that can rewrite metadata.

## Comments and layout

Both Engine and trusted selection bridge use `dom-text-v1`, not a generated
JSON content tree. Text ranges use Unicode code points; images/layout can use
element targets. Comment origins never change, and recovery is explicit.
Slides use optional body/section hints plus authored CSS; the Viewer only
supplies navigation.

The HTML is sandboxed away from review controls. Preview URLs grant immutable
read-only content, while independent Owner and Reviewer session secrets gate
role-specific review APIs. The frame never receives those secrets.

See [the concrete MVP contract](html-mvp.md) for exact encodings and limits.
