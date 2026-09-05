# DSTAR Vision

DSTAR lets people review AI-generated documents directly, revise them across
multiple rounds, and retain the feedback and decisions behind each version.

For integrating developers, DSTAR adds document review and revision to an AI
product while keeping documents and data on the host's infrastructure.

## Who we serve

The initial users review reports, proposals, design explanations and slide
decks that an agent has already drafted. The initial integrators build products
that generate those documents and need a repeatable review experience.

The hard part begins after the first draft: people copy excerpts into chat,
explain where an edit belongs, compare replacement files, and lose track of
which feedback was addressed. DSTAR should make the second and third review
round as understandable as the first.

## The experience to deliver

A reviewer opens an AI-generated report and leaves three local comments. The
Owner selects those comments, adds a general instruction and sends one revision
request. The agent returns a suggested version. The Owner can locate the
changes and the feedback they relate to, accept or decline the suggestion, and
return the next day to continue reviewing.

The standalone implementation supports this flow with durable batch requests,
external handoff, an optional trusted-host invocation callback and linked review
navigation. Core, CLI, MCP and Viewer are verified by repository automation and
a controlled test agent, not by a real model provider or deployed external
product. Cross-product host/provider validation is deferred and is not a
completion condition for DSTAR's standalone delivery. See the
[roadmap](design/roadmap.md) and
[review-round design](design/review-rounds.md) for the evidence boundary.

The product should answer four questions without exposing storage details:

- What text and version did this feedback refer to?
- What did the agent change, and which feedback motivated it?
- Which version did the Owner accept, and what remains unresolved?
- Can another authorized reviewer or a returning user continue the discussion?

Durable history and exact revisions support these answers. They become a
product advantage when the review experience is clear and easy to integrate.

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

A CLI remains sufficient for agent authoring. External products may instead use
the pre-stable TypeScript SDK or self-host the Viewer at their own origin. A
host owns its storage, identity, agent execution and deployment lifecycle.

The optional agent invocation hook reuses the same Engine and durable request
contract. The mountable Viewer is a supported standalone integration surface.
A separate overlay package or claims about a particular external product still
require future evidence. Core remains independent of model providers and agent
execution.

The current runtime uses a DSTAR filesystem package. Host ownership does not
yet mean that any existing database or document store can replace that package.

## The loop

```text
reviewer feedback and Owner intent
    -> Engine freezes an exact-base revision request and feedback snapshot
    -> host callback or scoped external handoff asks an agent for a candidate
    -> agent or host submits through CLI, SDK or an authorized adapter
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
dependency. A small state header and separate proposal, comment-thread and
revision-request JSON records keep small review updates from rewriting the whole
collaboration history.
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

## Focus and priorities

The implemented standalone flow selects multiple open comments, adds a general
instruction, sends once through external handoff or a configured host callback,
and receives a linked revision proposal. Basic navigation connects requests,
comments, proposals and local Before / After changes while labeling fallbacks
that cannot be mapped to one element. Future cross-product validation may test
this contract in a real product, but is outside the current delivery scope.

Static HTML reports, designed documents and slides share this workflow.
Interactive application editing, framework source mapping and deployment are
outside the initial product focus. Direct inline editing and canonical Markdown
are deferred until a concrete user or integration need justifies their cost.
Markdown import could produce canonical HTML; preserving Markdown as authority
would require a separate source-mapping and revision design.

Core consistency and recovery guarantees remain requirements. Broader storage,
format and protocol work should follow demonstrated correctness, scale or
integration needs. The current SDK and artifact format remain pre-stable.

## How we assess progress

Measure time and host work required to complete the first accepted revision,
manual copy/paste and context re-entry during a round, and whether a user can
resume a second round after reopening the document. Establish a baseline with
the current Viewer and compare the same scenario after each milestone.

These measures are a validation plan, not reported results. Successful
multi-round use and lower integration effort should guide priorities ahead of
feature count.
