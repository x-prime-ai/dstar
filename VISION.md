# DSTAR Vision

## The shift

Documents were designed for a world in which people wrote and read nearly every
word. AI changes both sides of that relationship: agents can draft, transform,
and maintain large amounts of content, while people increasingly direct the
work, inspect what matters, discuss it, and make decisions.

The scarce resource is no longer text production. It is shared understanding,
human attention, and accountable judgment.

Existing formats do not preserve this new collaboration well. Markdown is easy
to generate and inspect but has limited expressive power and no portable review
model. HTML can create excellent reading experiences but mixes meaning with
presentation and is a poor source of truth for structured change. Office and
workspace applications support rich documents and comments, but keep content,
review state, and automation inside a proprietary system.

## Vision

DSTAR is an open, portable protocol for AI-native collaborative documents.
Agents author and maintain canonical content; humans direct the work, comment
on precise meaning, and decide what becomes part of the document.

A DSTAR document is not only formatted text. It is a portable semantic object
containing content, stable identity, discussion, delegations, proposed changes,
evidence, assets, provenance, and addressable views. Humans and agents can use
different interfaces and views without creating different sources of truth.

DSTAR standardizes the document object that moves between review clients,
renderers, and agents. It does not standardize a particular model,
collaboration server, storage backend, or user interface.

## Product promise

With DSTAR, a person should be able to:

- read a polished, accessible document with the expressive range expected from
  a modern web experience;
- select a precise passage or semantic object and start a portable discussion;
- leave a comment without immediately assigning it to an agent;
- delegate an anchored comment or requested change to a capable agent;
- inspect the agent's local, source-backed proposal before it is committed;
- understand which sources, comments, delegations, and actors motivated a
  change;
- inspect accepted history and recover canonical content at any accepted
  version;
- retain review provenance when content or a derived view changes; and
- move the document, its collaboration state, and its decision history to
  another conforming tool.

An agent should be able to:

- create the initial canonical document from human direction and evidence;
- request only the semantic content and review context relevant to its task;
- address document objects by stable identifiers rather than DOM paths or line
  numbers;
- understand what a person saw, selected, discussed, and delegated;
- make structured, conflict-aware, idempotent proposals;
- preserve content and extensions it does not understand; and
- work without parsing presentation-oriented HTML or proprietary office XML.

## The DSTAR object

DSTAR separates five connected layers:

1. **Canonical content** — an agent-authored semantic document tree with durable
   IDs.
2. **Collaboration state** — comments, replies, delegations, and their lifecycle
   outside canonical content.
3. **Changes** — agent-authored, revision-aware proposals, human decisions, and
   accepted canonical version history.
4. **Evidence and provenance** — sources, actors, generators, and motivations.
5. **Projections** — addressable human and agent views with mappings back to
   canonical content.

In DSTAR 0.1, canonical content is the JSON semantic tree in `document.json`
inside a `.dstar` directory. Markdown, HTML, summaries, and agent context are
projections, imports, or exports; they are not competing canonical sources.

The semantic tree stores meaning and review identity. It does not attempt to
store a browser DOM or all of CSS. Content profiles, assets, renderers, and
themes provide rich tables, figures, media, equations, interactive components,
and presentation without turning generated HTML into the source of truth.

## Initial users and documents

The first users are individuals and small teams already using AI to create and
maintain consequential, long-lived documents. They need a strong reading
experience, precise discussion, and fast agent-mediated updates, but do not want
those capabilities tied to one workspace application.

Initial document categories include:

- product specifications and design documents;
- research reports and analyses;
- proposals, plans, and decision records;
- tutorials, manuals, and knowledge documents; and
- rich documents containing tables, figures, citations, media, or embeds.

The first implementation may use local files and asynchronous collaboration to
keep the protocol testable. DSTAR does not require Git or assume that its users
are software developers.

## Experience model

A person encounters a DSTAR document through reviewable views, not by directly
manipulating canonical content:

- A **canonical view** is a faithful, read-only rendering of the current
  semantic document. A selection maps directly to canonical nodes and ranges.
- A **projection** is a derived, versioned view such as a polished HTML report,
  summary, Markdown export, or focused agent context. A selection maps through
  the projection's source map to canonical content.

Both may look like rich HTML in a browser. Human actions create comments,
delegations, replies, and decisions. Every canonical content change, including
a typo fix, is produced by an agent as a proposal.

The human creates the selection in the displayed view. DSTAR records semantic
identity, quotation, position, context, and projection mappings so that target
precision is a protocol property rather than a model's guess from natural
language.

## North-star workflow

```text
human provides intent and evidence
    -> agent creates or updates the semantic document
    -> a person reads it through a rich web experience
    -> the person selects content and comments
    -> the comment remains open, is discussed, or is delegated to an agent
    -> the agent returns a local, traceable proposal
    -> an authorized person accepts, rejects, or continues the discussion
    -> the document and its views update without silently losing review context
```

Success is measured by whether DSTAR improves collaboration and preserves
understanding, not by generated word count. Initial measures are:

- time from a comment or delegation to a correct, reviewable proposal;
- selection-to-proposal latency and acceptance rate for trivial changes;
- the share of review targets that remain exactly or unambiguously resolvable
  after changes and projection regeneration;
- the rate at which proposals require regeneration before a decision; and
- preservation of content and collaboration state across independent tools.

## Principles

### Agents author, humans direct and decide

Agents produce and modify all canonical content. Humans do not edit canonical
content directly, at any scale, including trivial changes such as typo fixes.
Every content change is an agent-mediated, provenance-bearing proposal that a
human accepts, rejects, supersedes, or continues to discuss.

Humans retain full authority over what becomes canonical, but exercise that
authority through direction, precise feedback, delegation, and decision rather
than direct manipulation of the document.

### Comments exist before delegation

A human can select content and create a durable comment without invoking an
agent. The comment may support discussion, mark an unresolved question, or
remain open for later work. Delegation is a separate, explicit action that
assigns an existing comment or request to an agent.

Comment lifecycle, delegation lifecycle, and change lifecycle remain distinct.
Producing a proposal does not silently resolve the comment that motivated it.

Delegation assumes an existing annotation anchored to canonical content or a
projection. Genesis is the only authoring path without a pre-existing document
target: the human provides intent and evidence, and an agent proposes the
initial canonical document.

### Human approval is the commit boundary

In DSTAR 0.1, accepting any canonical content change requires an explicit
decision by an authorized human. Policies and services may validate, block,
defer, or request a new proposal, but they do not act as an accepting authority.
Provenance records which agent authored and which human accepted each change.

### Portable collaboration state

Comments, replies, delegations, proposals, decisions, and their targets travel
with the document. They are not database-only application metadata. Real-time
presence and synchronization may be provided by an implementation without
becoming the only durable copy of collaboration state.

### Precise human selection, durable semantic anchors

Humans select text or semantic objects in the view they actually saw. Document
objects have durable identifiers; inline ranges also carry position, quotation,
and surrounding context. Projection selections carry explicit source mappings.
No single positional coordinate is trusted to survive a rewrite, and an agent
is never asked to infer the original target from prose alone.

Moving or changing the same semantic object preserves its ID. Splitting or
merging objects creates an identity-lineage question rather than silently
assigning an old ID to an arbitrary result. DSTAR 0.1 favors an unresolved
target over an incorrectly reattached comment; portable lineage for structural
rewrites remains an open design problem.

### Local proposals over whole-document rewrites

After initial document creation, agents propose ordered operations against
explicit targets, revisions, and local preconditions. Replacing an entire
existing document is exceptional, not the default.

### One truth, multiple addressable views

A canonical view, HTML report, summary, Markdown export, and agent context may
present the same document differently. Only the canonical semantic document is
the source of truth. Derived projections carry explicit versions and mappings
so that review performed on them remains explainable.

A projection comment records both what the person actually saw and the
canonical sources from which it was derived. After regeneration, a tool may
reattach it only when the new mapping is unambiguous. Otherwise the comment
remains visible as unresolved review work with its original provenance intact.

### Rich expression through semantic composition

DSTAR should support excellent human reading experiences without making HTML
or a specific application schema canonical. A small semantic core composes with
declared profiles, assets, themes, and deterministic renderers. Unsupported
rich objects produce visible fallbacks and remain losslessly preservable.

### Open files and replaceable implementations

A document remains inspectable and recoverable without a hosted DSTAR service.
Any review client, renderer, or agent can implement the protocol, and no
reference application defines the format by itself.

### Small core, explicit profiles

The base content model stays small. Rich domain objects are introduced through
named profiles and extensions that conforming readers can preserve even when
they cannot render them.

## First milestone

DSTAR 0.1 will prove one interoperable creation and review loop:

1. Record an agent-authored genesis proposal and human acceptance that create a
   small semantic document in a `.dstar` directory.
2. Render the document as a rich canonical view and reviewable HTML projection.
3. Attach a comment to a human-created selection in either view.
4. Leave the comment open or explicitly delegate it to an agent.
5. Create an agent-authored local change with document and operation
   preconditions.
6. Detect a stale or locally conflicting proposal without overwriting content.
7. Accept, reject, supersede, or regenerate the proposal without mutating its
   original payload.
8. Regenerate affected views while preserving original review provenance and
   surfacing ambiguous targets for human confirmation.
9. Materialize and validate an earlier accepted canonical version from the
   portable change chain.
10. Validate the same package with an independent conforming implementation.

Conflict detection is in scope for 0.1. A conflicting proposal remains
unapplied and may be rejected, superseded, or replaced by an explicit rebased
proposal. Interactive merge and conflict-resolution UX is deferred.

## Non-goals for 0.1

- Any interface for directly editing canonical content, including typo fixes or
  other small changes; all content changes are agent-mediated proposals
- Google Docs, Notion, or Microsoft Word feature parity
- Real-time multi-user synchronization or a standardized CRDT; these are
  deferred, not permanently excluded
- Cryptographic proof that no out-of-band modification has occurred
- Pixel-perfect DOCX round trips or a general-purpose browser layout engine
- Standardizing a viewer's DOM, selection implementation, or transient positions
- A built-in model provider or model subscription
- Cloud accounts, billing, or organization administration
- A complete knowledge base or retrieval system
- Standardizing every possible rich-content node or interaction
- Requiring Git, a hosted review service, or a particular storage backend
- Treating generated content volume as product value

The specification should remain small enough that an independent developer can
write a conforming reader, renderer, review client, and change processor without
adopting the reference implementation.
