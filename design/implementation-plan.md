# Implementation status

Delivered reference implementation as of 2026-09-04. The
[roadmap](roadmap.md) owns future priority order; the
[review-round design](review-rounds.md) describes the implemented milestones
1/2 contract and incomplete real-host embedding milestone.

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
- Durable batch revision requests in the third `records-v1` collection, with
  exact base, frozen feedback/replies, requester, status, attempts and linked
  proposal identity.
- Core create/update/link APIs, Owner-only Viewer request/invoke routes, batch
  external handoff and optional trusted-host `agentInvocation` callback.
- Request status/drift UI and basic request → proposal and comment → proposal →
  changes navigation.

## Verification

The new Engine tests exercise byte-delta roundtrips, Unicode, historical replay
through checkpoints, asset reuse/deletion, stale bases, stale review state,
idempotency, comments, interrupted checkout recovery, corrupt objects,
out-of-band changes and unsafe HTML/CSS.

Viewer HTTP tests cover session authentication, origin checks, immutable
sandboxed previews, comments and exact decisions. Browser verification checks
actual presentation, selecting text, adding comments and review controls.

The milestone 1/2 additions are verified by current automated Core/UI/Viewer
tests using real filesystem persistence, loopback HTTP and a controlled test
agent callback. This is not a real provider run or production host deployment.

## Next work

The next product milestone is real-host embedding validation: complete two
review rounds at the host's own origin with its identity, filesystem package and
provider execution. The repository example and controlled test agent do not
satisfy that milestone. Deeper comment-to-change navigation follows observed
real-host friction.

See the [roadmap](roadmap.md) for exit evidence, validation measures and the
engineering backlog. Canonical Markdown, direct inline editing and broader
storage/protocol work are deferred until a concrete need justifies them.

The integrating product mounts `@dstar/mcp` using its chosen MCP transport and
authentication. Browser WebMCP in the reference Viewer is an additional UI
integration; both surfaces use the same Core API.
