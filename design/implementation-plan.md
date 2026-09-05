# Implementation status

Delivered foundation as of 2026-09-04. The [roadmap](roadmap.md) owns future
priority order; the [review-round design](review-rounds.md) describes planned
batch feedback and host integration. Neither is already delivered by this list.

## Delivered

- Independent `@dstar/core` and `pnpm dstar` launcher, without Git.
- Complete static HTML/CSS/assets candidate validation and stable-ID indexing.
- Exact revision hashing, compressed copy/insert deltas, blob fallback,
  content-addressed deduplication and checkpoints every 20 accepted versions.
- Pending genesis/update proposals with exact bases and idempotent retries.
- Linear accepted history, verified historical export and replay.
- Locked writes, authoritative state switch and checkout recovery journal.
- Element and single-element Unicode text comments, replies, explicit recovery
  status and separate human resolution.
- Proposal links to multiple open comments through `motivatedBy`; this is a
  Core capability, not yet a batch-selection and submission experience.
- Viewer sandbox, exact base/candidate previews, bounded review summaries,
  pending queue, accepted history and human acceptance/rejection.
- Doc-like/rich HTML and slide examples using one format.
- Repo-local agent skill using actual CLI commands.
- Publish-ready `@dstar/core` TypeScript API for the complete document lifecycle.
- Publish-ready `@dstar/mcp` adapter with caller-scoped read, propose, comment,
  reply, decision and resolution tools.
- Publish-ready `@dstar/viewer`, a host-owned deployment contract and a
  compile-checked external TypeScript consumer.
- Role-bound Owner/Reviewer sessions, browser WebMCP and scoped external-agent
  handoff, including comment-focused draft and revision workflows.

## Verification

The new Engine tests exercise byte-delta roundtrips, Unicode, historical replay
through checkpoints, asset reuse/deletion, stale bases, stale review state,
idempotency, comments, interrupted checkout recovery, corrupt objects,
out-of-band changes and unsafe HTML/CSS.

Viewer HTTP tests cover session authentication, origin checks, immutable
sandboxed previews, comments and exact decisions. Browser verification checks
actual presentation, selecting text, adding comments and review controls.

## Next work

The next product milestone is a complete review round: select several comments,
add a general instruction, send once, inspect the linked suggestion, decide and
resume later. Batch requests and optional host-connected agent invocation come
first; embedding validation and better comment-to-change navigation follow.

See the [roadmap](roadmap.md) for exit evidence, validation measures and the
engineering backlog. Canonical Markdown, direct inline editing and broader
storage/protocol work are deferred until a concrete need justifies them.

The integrating product mounts `@dstar/mcp` using its chosen MCP transport and
authentication. Browser WebMCP in the reference Viewer is an additional UI
integration; both surfaces use the same Core API.
