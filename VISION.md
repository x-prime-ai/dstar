# DSTAR Vision

## The shift

Documents were designed for a world in which people wrote and read nearly every
word. Agents can now produce and maintain most of a document, while people
increasingly read summaries, inspect important passages, leave feedback, and
make final decisions.

The scarce resource is no longer text production. It is human attention and
judgment.

Existing formats do not preserve that new division of labor. Markdown is easy
for agents but has no durable review model. HTML is expressive but mixes
meaning with presentation. Office and workspace applications support comments
and suggestions, but keep their content and review state inside a proprietary
system.

## Vision

DSTAR is an open, portable protocol for reviewable documents, where agents
produce and maintain content while humans retain judgment and authority.

A DSTAR document is not only formatted text. It is a portable semantic object
containing content, stable identity, discussion, proposed changes, evidence,
assets, provenance, and addressable views. Humans and agents can use different
views without creating different sources of truth.

DSTAR standardizes the object that moves between editors and agents. It does
not standardize a particular editor, model, collaboration server, or user
interface.

## Product promise

With DSTAR, a person should be able to:

- read a rich document, summary, or other projection;
- comment on a precise passage or semantic object in that view;
- retain the comment's connection to canonical content across regeneration and
  rewrites;
- assign the feedback to any capable agent;
- inspect the agent's proposed change as a local, source-backed diff;
- accept, reject, or continue the discussion; and
- move the document, its review state, and its decision history to another
  conforming tool.

An agent should be able to:

- request only the context relevant to its task;
- address document objects by stable identifiers;
- understand which projection and source material a person reviewed;
- make structured, conflict-aware, idempotent proposals;
- explain which feedback and evidence motivated a change; and
- work without parsing presentation-oriented HTML or proprietary office XML.

## The DSTAR object

DSTAR separates five connected layers:

1. **Canonical content** — a small semantic document tree with durable IDs.
2. **Review state** — comments and threads stored outside canonical content.
3. **Changes** — revision-aware proposals that require an explicit decision.
4. **Evidence and provenance** — sources, actors, generators, and motivations.
5. **Projections** — addressable human and agent views with mappings back to
   canonical content.

The portable review state is the center of the design. Rich-text editing,
real-time collaboration, and AI chat are implementation capabilities around
that object.

## Initial users

The first users are individuals and small teams that already use coding agents,
Markdown, and Git for product specifications, technical designs, RFCs, research
reports, and similar documents.

This audience has an immediate need for reviewable agent edits and can evaluate
the protocol without requiring a complete office suite.

## North-star workflow

```text
agent produces canonical document
    -> human reads a projection
    -> human comments on meaning
    -> agent proposes a traceable change
    -> human decides
    -> projections regenerate without losing review context
```

The primary success measure is the time from a human comment to a correct,
reviewable change. Generated word count is not a success measure.

## Principles

### Human judgment is the authority boundary

Agent-authored changes are proposals until an authorized human or policy makes
an explicit decision. Provenance records who proposed and who approved every
material change. An agent cannot be the sole approver of its own proposal.

### Portable review state

Comments, replies, suggestions, decisions, and their targets travel with the
document. They are not database-only application metadata.

### Semantic identity with redundant anchors

Document objects have durable identifiers. Inline ranges also carry position,
quotation, and surrounding context. No single positional coordinate is trusted
to survive a rewrite.

### Local proposals over whole-document rewrites

Agents propose ordered operations against explicit targets, revisions, and
local preconditions. Replacing an entire document is exceptional, not the
default.

### One truth, multiple addressable views

Markdown, HTML, summaries, and agent context are projections of the canonical
document. A projection may be regenerated, but its version and its mapping to
canonical nodes are explicit so that review performed on the projection is not
lost.

### Open files and replaceable implementations

A document remains inspectable and recoverable without a hosted DSTAR service.
Any editor or agent can implement the protocol, and no reference application
defines the format by itself.

### Small core, explicit profiles

The base content model stays small. Rich domain objects are introduced through
named profiles and extensions that conforming readers can preserve even when
they cannot render them.

### Graceful degradation

Core text, metadata, and assets use broadly supported encodings. Unsupported
content produces a visible fallback or diagnostic rather than disappearing.

## First milestone

DSTAR 0.1 will prove one interoperable review loop:

1. Store a small semantic document in a `.dstar` directory.
2. Generate a summary projection with mappings to canonical nodes.
3. Attach a comment using stable identity, range, quotation, and revision.
4. Create an agent-authored change with document and operation preconditions.
5. Detect a stale or locally conflicting proposal without overwriting content.
6. Accept or reject the proposal with separate authorship and decision records.
7. Render the resulting document and preserve projection review context.
8. Validate the same package with an independent conforming implementation.

## Non-goals for 0.1

- Google Docs or Microsoft Word feature parity
- Real-time multi-user collaboration or a standardized CRDT
- Pixel-perfect DOCX round trips
- A built-in model provider or model subscription
- Cloud accounts, billing, or organization administration
- A complete knowledge base or retrieval system
- Standardizing every possible rich-content node
- Standardizing an editor's internal document model or transient positions
- Treating generated content volume as product value

The specification should remain small enough that an independent developer can
write a conforming reader and review client without adopting the reference
implementation.
