# Reference architecture

Status: implemented local MVP; development format, not a stable public SDK.

## Three responsibilities

```text
Agent + DSTAR skill ──CLI──> Engine <──private local adapter── Viewer
                              │                             │
                    proposal/delta/history          preview/select/comment
                              │                     Owner accept/reject
                              ▼
                       portable directory
```

The Engine is independent of the Viewer. Its proposal operation derives and
stores candidate revision, compact byte deltas and review summaries immediately.
A Viewer is not needed to prepare a proposal or reconstruct historical HTML.

The Viewer does not calculate or own versions. Its local server reads immutable
materializations and submits attributed collaboration or Owner decision commands
to the Engine. Its centralized role gate gives Reviewer read/comment/reply/
handoff capabilities; document proposals, decisions and resolution are Owner-only.
There is no new MCP service, workflow backend, projection renderer or public SDK.

## Code

- `packages/engine`: file inventory, HTML/CSS validation, hashes, byte deltas,
  materialization, comments, proposals and locked/journaled writes.
- `packages/engine/src/cli.ts`: validate, inspect, export, propose, comment, reply.
- `packages/engine/src/decisions.ts`: internal adapter for Owner decisions;
  deliberately absent from the agent command set.
- `apps/viewer`: loopback HTTP adapter and static browser UI.
- `scripts/dstar.mjs`: repository launcher, including `serve`.
- `skills/dstar-documents`: agent operating instructions and format references.

Legacy modules remain unchanged and are not dependencies of the new Engine.

## Directory storage

The portable artifact remains an ordinary directory, with no SQLite or Git
runtime requirement. A small `.dstar/state.json` commits the head, generation
and counts of separately stored proposal and comment-thread JSON records.
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
