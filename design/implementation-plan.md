# Implementation status

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
- Viewer sandbox, exact base/candidate previews, bounded review summaries,
  pending queue, accepted history and human acceptance/rejection.
- Doc-like/rich HTML and slide examples using one format.
- Repo-local agent skill using actual CLI commands.
- Publish-ready `@dstar/core` TypeScript API for the complete document lifecycle.
- Publish-ready `@dstar/mcp` adapter with caller-scoped read, propose, comment,
  reply, decision and resolution tools.
- Publish-ready `@dstar/viewer`, a host-owned deployment contract and a
  compile-checked external TypeScript consumer.

## Verification

The new Engine tests exercise byte-delta roundtrips, Unicode, historical replay
through checkpoints, asset reuse/deletion, stale bases, stale review state,
idempotency, comments, interrupted checkout recovery, corrupt objects,
out-of-band changes and unsafe HTML/CSS.

Viewer HTTP tests cover session authentication, origin checks, immutable
sandboxed previews, comments and exact decisions. Browser verification checks
actual presentation, selecting text, adding comments and review controls.
## Next work, not silently part of this MVP

- Publish a normative schema and independent revision/delta vectors.
- HTML5 parser parity and a larger adversarial HTML/CSS/browser corpus.
- Durable multi-user principals, external authorization and cross-platform
  filesystem/crash testing.
- Safer automatic abandoned-lock recovery; currently an explicit operator step.
- Search/pagination for large histories and bounded streamed materialization.
- Rich CSS/property diff, comment highlight navigation and cross-element ranges.
- Better slide sizing/fullscreen/accessibility and review ergonomics.
- Explicit retention/GC/compaction.

The integrating product mounts `@dstar/mcp` using its chosen MCP transport and
authentication. Browser WebMCP in the reference Viewer is an additional UI
integration; both surfaces use the same Core API.
