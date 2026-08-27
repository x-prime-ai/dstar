# DSTAR Vision

## The shift

Documents increasingly outlive the application, workflow, and automation that
created them. The scarce resources are shared understanding, human attention,
and accountable judgment—not text production.

Existing formats split the problem poorly. Markdown is inspectable but has a
limited review model. HTML is expressive but mixes meaning with presentation.
Workspace applications support comments and review, but usually keep those
records inside one proprietary service.

## Vision

DSTAR is an open, portable protocol for collaborative documents. A DSTAR
document contains canonical semantic content, stable identity, discussion,
proposed changes, decisions, evidence, assets, provenance, and addressable
views.

DSTAR standardizes the document object shared by SDKs, review clients,
renderers, command-line tools, MCP clients, and other integrations. It does not
standardize who or what invokes those interfaces. Models, automation runtimes,
workflow engines, authentication, and provider configuration stay outside the
document protocol.

## Product promise

A person should be able to:

- read a polished, accessible document;
- select a precise passage or semantic object and start a portable discussion;
- assign a comment to another person;
- use any external tool to prepare a reply or proposal on their behalf;
- inspect a local, source-backed proposal before it becomes canonical;
- understand which sources, comments, and participants motivated a change;
- inspect accepted history and recover any accepted canonical version; and
- move the document and its review state to another conforming tool.

A conforming client should be able to:

- address semantic objects by stable identifiers rather than DOM paths;
- request only the document and review context it needs;
- create structured, conflict-aware, idempotent proposals;
- preserve extensions it does not understand; and
- operate without parsing presentation-oriented HTML as source of truth.

## The DSTAR object

DSTAR separates five connected layers:

1. **Canonical content** — a semantic document tree with durable IDs.
2. **Collaboration state** — comments, replies, human assignment, and lifecycle.
3. **Changes** — revision-aware proposals, decisions, and accepted history.
4. **Evidence and provenance** — sources, participants, generators, and
   motivations.
5. **Projections** — addressable views with mappings back to canonical content.

In DSTAR 0.1, canonical content is the JSON semantic tree in `document.json`
inside a `.dstar` directory. Markdown, HTML, summaries, and focused machine
context are projections, imports, or exports; they are not competing canonical
sources.

## Experience model

A person encounters a document through reviewable, read-only views:

- A **canonical view** faithfully renders the current semantic document.
- A **projection** is a derived, versioned view such as HTML, Markdown, a
  summary, or plain text.

A selection maps to durable DSTAR targets. Human actions create comments,
replies, assignments, and decisions. Canonical changes are always represented
as proposals before acceptance, regardless of whether a person, script,
service, SDK client, or other external system prepared them.

```text
intent + evidence
    -> a client submits a genesis or update proposal
    -> a person reviews the document and comments precisely
    -> the comment may be assigned to a person
    -> that person may use any tools outside DSTAR to prepare a response
    -> a proposal is simulated and reviewed
    -> an authorized person accepts, rejects, or continues discussion
```

## Principles

### The protocol is caller-independent

Portable data never depends on a model, provider, runtime session, tool loop,
or task orchestrator. DSTAR records document participants and proposal
provenance, not the implementation that produced an SDK or MCP call.

An integration may retain local correlation IDs and audit metadata, but those
records are non-portable and cannot become document authority.

### Assignment is human responsibility

An annotation may have a human assignee. DSTAR does not assign comments to
software executors and does not contain a delegation or task lifecycle. The
assignee remains accountable even when they use an external tool to read,
reply, or prepare a proposal.

### Proposal and decision are separate authorities

Submitting a proposal never changes canonical content. Acceptance is a
separate, explicit human decision. SDK and MCP proposal surfaces do not expose
accept, reject, supersede, or resolve operations.

This separation is enforced by capabilities and API surfaces, not by guessing
what kind of software invoked an operation.

### Comments exist independently of assignment and proposals

A comment may support discussion, record a question, or request a change. It
may be unassigned or assigned to a person. Replying, submitting a proposal,
accepting a proposal, and resolving the comment are distinct transitions.

### Precise selection and durable anchors

Document objects have durable identifiers. Inline ranges carry position,
quotation, and surrounding context. Projection selections carry explicit
source mappings. No single positional coordinate is trusted to survive a
rewrite.

### Local proposals over whole-document rewrites

After genesis, clients propose ordered operations against explicit targets,
revisions, and local preconditions. Whole-document replacement is exceptional.

### One truth, multiple addressable views

Only the canonical semantic document is source of truth. Derived projections
carry versions and mappings so review remains explainable after regeneration.

### Open files and replaceable implementations

A document remains inspectable without a hosted service. Any conforming SDK,
renderer, review client, MCP adapter, or other integration may implement the
protocol without becoming part of the portable model.

## First milestone

DSTAR 0.1 proves one interoperable loop:

1. Record and accept a genesis proposal.
2. Render canonical and reviewable projected views.
3. Attach a comment to a precise human selection.
4. Optionally assign the comment to a person.
5. Submit a local update proposal with explicit bases and preconditions.
6. Detect stale or conflicting proposals without overwriting content.
7. Accept, reject, or supersede a proposal without mutating its payload.
8. Regenerate views while preserving review provenance.
9. Materialize an earlier accepted canonical version.
10. Validate the same package with an independent implementation.

## Non-goals for 0.1

- Direct editing of canonical content outside the proposal/decision flow
- A built-in model, provider, workflow engine, or task orchestrator
- Encoding runtime sessions or external execution state in the package
- Google Docs, Notion, or Microsoft Word feature parity
- Real-time multi-user synchronization or a standardized CRDT
- Cryptographic proof against out-of-band modification
- Pixel-perfect DOCX round trips
- Standardizing a viewer DOM or transient editor positions
- Cloud accounts, billing, or organization administration
- Requiring Git, a hosted service, or a particular storage backend

The specification should remain small enough for an independent developer to
write a reader, renderer, review client, and change processor without adopting
the reference implementation.
