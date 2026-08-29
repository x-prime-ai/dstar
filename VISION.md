# DSTAR Vision

DSTAR makes AI-authored HTML documents reviewable and versioned with as little
machinery as possible.

## One artifact

An agent can create a plain document, a richly designed page or slides directly
as HTML. The presentation is the source: `document.html`, CSS and assets.
There is no second JSON content model, no shared source with multiple generated
views, and no protocol-level doc/html/slides type.

Layout and design belong to the authored HTML and CSS. Skills and templates
help the agent produce the right experience without restricting every document
to one component tree.

## The small product

DSTAR needs a skill, a small deterministic Engine and a Viewer:

- The skill helps an agent create and revise files, preserve stable IDs, read
  feedback and submit proposals.
- The Engine runs in the agent's update workflow. It validates a complete
  candidate, computes its revision, review diff and compact storage delta, and
  persists the proposal before any Viewer is involved.
- The Viewer displays the stored result, captures selection/comments, and
  provides a separate human accept/reject action. It delegates persistence
  and exact-base verification to the same Engine.

A CLI is sufficient for the first agent integration. MCP and a public SDK are
not required. The Engine is an implementation utility, not a new platform,
agent orchestrator or hosted service. Its internal module boundaries do not
imply a promise of public SDK compatibility.

## The loop

```text
human intent
    -> agent prepares a complete staged HTML/CSS/assets candidate
    -> skill invokes Engine through CLI
    -> Engine validates and stores revision + review diff + storage delta
    -> Viewer reads exact base/candidate; human comments or decides
    -> Engine verifies candidate and base, then commits an accepted head
```

Genesis uses the same review boundary. Until acceptance there is a proposal
but no accepted document. Comments and replies never modify HTML or implicitly
accept or resolve a change.

## Comments

Meaningful HTML elements carry stable `data-dstar-id` values. A comment binds
its original revision and element; text comments also record a Unicode range,
exact quotation and optional context. The original target is retained.
Changed ranges may be recovered within the same element, but ambiguity or loss
is surfaced instead of silently attaching feedback elsewhere.

## Versions without full-copy explosion

Every version is logically a complete immutable document. Its physical history
does not need a complete copy on every edit:

- unchanged files reuse existing content;
- small changes use compressed exact-base deltas;
- large rewrites may use compressed replacement blobs;
- assets and identical objects are deduplicated;
- checkpoints bound replay depth; and
- every materialized version verifies against its recorded hash.

This borrows Git-like ideas; it neither executes Git nor requires a repository.
The Engine generates and verifies deltas, not the language model.
The bundle stays a portable directory of ordinary files, without a SQLite
dependency. A small state header and separate proposal/comment-thread JSON
records keep small review updates from rewriting the whole collaboration history.
The Engine owns cross-file commit and recovery; agents use its simple interface.
Real new content and long review history still consume storage; retention and
compaction must be explicit, never silently discard accepted history.

## Boundaries

The agent proposes; the human decides. The agent CLI has no accept path.
The Viewer cannot turn a stale candidate into a fresh one. Acceptance must name
the exact proposal, candidate and current review state, then verify the base
again under the Engine's write lock.

HTML/CSS are untrusted presentation data. Package scripts and remote resources
are excluded from the first profile. A sandbox isolates authored layout from
review controls. Local filesystem access is a trusted-host boundary, not
cryptographic proof that only a human could modify the files.

## Initial scope

Deliver a useful local creation → review → comment → revision → history loop.
Keep the canonical format and module count small.

Not required for the initial version: MCP, a published SDK, Git, a hosted
backend, real-time collaboration, branches/merges, a universal document tree,
arbitrary web applications, automatic comment execution, or office-format
export. Independent interoperability and a stable specification follow the
working prototype, rather than being claimed prematurely.
