# Changes

Status: **Pre-Draft**

A change is an agent-authored proposal to create or transform canonical
content. Humans direct work through comments and delegations and decide whether
a proposal becomes canonical; they do not author change operations.

## Change kinds

DSTAR 0.1 defines two change kinds:

- `genesis` proposes the first canonical document; and
- `update` proposes a transformation of an existing canonical revision.

Both kinds use the same proposal and decision lifecycle. Whole-document
creation is permitted only for genesis. An update uses local operations rather
than replacing the existing document by default.

## Change record

A change record contains:

- a stable change ID and idempotency key;
- its `genesis` or `update` kind;
- an agent author;
- one or more ordered operations;
- an initial `proposed` status;
- optional links to annotations, delegations, and sources that motivated it;
  and
- an explicit human decision when no longer proposed.

An update additionally contains the canonical revision against which it was
authored. Once published, the proposal payload — kind, base revision, author,
motivations, sources, and operations — MUST NOT be mutated. A replacement or
rebase has a new change ID. Status and decision metadata may be added by an
authorized Change Applier.

## Genesis

A genesis change has no `baseRevision`. It contains exactly one
`create_document` operation whose `value` is a complete root document conforming
to all declared content profiles.

Before acceptance, an authoring client may hold the genesis proposal outside a
completed `.dstar` package because no canonical document exists yet. Acceptance
atomically materializes `document.json`, its manifest revision, and the accepted
genesis record. The decision's `resultRevision` MUST equal the canonical
revision of the proposed root document.

DSTAR 0.1 standardizes the accepted genesis record in the resulting package;
transport and persistence of an unaccepted genesis proposal are
implementation-defined.

The genesis record identifies the agent that produced the initial content and
the human who accepted creation of the document. It is not an exception to the
agent-author and human-decision boundary.

## Update operations

Every update operation contains:

- a stable operation ID;
- an operation type;
- a stable target node ID;
- a local precondition; and
- operation-specific values.

The base update vocabulary is:

- `replace_text`
- `insert_node`
- `delete_node`
- `move_node`
- `set_attrs`

A local precondition contains the expected target-node hash and MAY contain the
expected text for a range. It detects conflicts precisely even when the whole
document revision has advanced for unrelated reasons.

`replace_text` uses inclusive `start`, exclusive `end` Unicode-code-point
offsets in the target node's text stream and supplies a string `value`.

Structural operations use `destination` with a parent node and, when needed, a
stable sibling reference. An array index MAY be used only as a fallback when no
stable sibling exists. Detailed containment validation is defined by the active
content profiles.

## Motivation and delegation

`motivatedBy` links a proposal to annotations that explain why the work exists.
`fulfills` links it to delegations whose requested execution produced the
proposal. A proposal may be motivated by a comment without a formal delegation,
and a delegation may complete without producing a change when the agent instead
reports that no valid change is available.

Creating a proposal does not resolve its motivating annotation. Comment,
delegation, and change lifecycle transitions are explicit and independent.

## Conflict handling

Before applying an update, a Change Applier MUST:

1. compare `baseRevision` with the current canonical revision;
2. verify every operation's local precondition;
3. validate the proposed result against all declared profiles; and
4. either apply all operations atomically or apply none.

If the base revision differs but every local precondition still holds, the
processor MAY produce an explicit rebased proposal with a new change ID and
base revision. It MUST NOT silently rewrite the existing proposal or treat it as
accepted.

The processor reports a stale base separately from a local target conflict. A
failed application attempt does not mutate canonical content, the proposal
payload, or its portable status. The proposal remains `proposed` until an
authorized human rejects or supersedes it, or a replacement proposal is
created.

DSTAR 0.1 does not standardize an interactive merge UI. A client SHOULD offer
the reviewer at least these paths: reject the proposal, supersede it with a new
proposal, or ask an agent to create an explicit rebase. Silently choosing a
conflict resolution is not conforming behavior.

## Idempotency

Repeating an application request with the same `idempotencyKey` MUST NOT create
the document or apply update operations more than once. An implementation MAY
retain a local operation ledger, but the accepted change and resulting revision
remain portable records.

## State and decision model

```text
proposed -> accepted
proposed -> rejected
proposed -> superseded
```

Every change author MUST be an agent. Every non-proposed change has a `decision`
whose actor MUST be an authorized human. An accepted decision additionally
records the resulting canonical revision. A rejected or superseded change does
not create or modify canonical content.

A policy or service may prevent application or request another proposal, but a
validation outcome is not a portable human decision. DSTAR 0.1 authoring clients
MUST NOT provide a path that serializes a human as the author of canonical
content, including for typo fixes or exact replacement instructions.
