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
- an optional human request containing direction that is not already represented
  by an annotation or delegation;
- one or more ordered operations;
- an initial `proposed` status;
- optional links to annotations, delegations, and sources that motivated it;
  and
- an explicit human decision when no longer proposed.

An update additionally contains the canonical revision and accepted head change
against which it was authored. Once published, every proposal field other than
lifecycle status and decision metadata MUST NOT be mutated. This includes its
request, motivations, fulfillments, sources, and operations. A replacement or
rebase has a new change ID. Lifecycle metadata may be added only by an
authorized Change Applier.

For every update, `baseChange` MUST identify an accepted change in the package,
and `baseRevision` MUST equal that change's accepted `resultRevision`. The base
change may be an earlier member of the accepted chain when a stale proposal is
retained for review.

## Genesis

A genesis change has neither `baseRevision` nor `baseChange`. It MUST contain a
`request` recording the human intent from which the document was generated, and
it contains exactly one `create_document` operation whose `value` is a complete
root document conforming to all declared content profiles.

Before acceptance, an authoring client may hold the genesis proposal outside a
completed `.dstar` package because no canonical document exists yet. Acceptance
atomically materializes `document.json`, its manifest revision and `headChange`,
and the accepted genesis record. The decision's `resultRevision` MUST equal the
canonical revision of the proposed root document, and `headChange` MUST equal
the genesis change ID.

DSTAR 0.1 standardizes the accepted genesis record in the resulting package;
transport and persistence of an unaccepted genesis proposal are
implementation-defined.

The genesis record identifies the agent that produced the initial content and
the human who accepted creation of the document. It is not an exception to the
agent-author and human-decision boundary.

## Accepted change chain

A completed package contains exactly one accepted genesis. Every accepted
update names its immediately preceding accepted change in `baseChange` and the
preceding content revision in `baseRevision`. Following `baseChange` backward
from the manifest's `headChange` MUST reach the genesis exactly once, without a
cycle, and every accepted change in the package MUST occur on that chain.

For each accepted update, `baseRevision` MUST equal its `baseChange` decision's
`resultRevision`. The head change's `resultRevision` MUST equal the manifest
revision. Change IDs therefore define history order while revisions continue to
identify content; a no-op or a later return to an earlier content revision does
not make history ambiguous. Proposed, rejected, and superseded changes do not
participate in the accepted chain.

A conforming authoring client MUST retain the accepted chain as portable
provenance. This requirement makes declared authorship and decisions available
to another tool; it does not provide cryptographic proof against out-of-band
file modification.

## Update operations

Every update operation has a stable operation ID, an operation type, and
operation-specific targets and preconditions.

The base update vocabulary is:

- `replace_text`
- `replace_inline`
- `insert_node`
- `delete_node`
- `move_node`
- `set_attrs`

A node precondition contains the expected node hash and MAY contain the expected
text for a range. It detects conflicts precisely even when the whole document
revision has advanced for unrelated reasons.

`replace_text` uses inclusive `start`, exclusive `end` Unicode-code-point
offsets in the target node's text stream and supplies a string `value`. To avoid
ambiguous mark inheritance, DSTAR 0.1 permits `replace_text` only when the target
node contains exactly one unmarked `text` inline item.

`replace_inline` replaces a node's complete inline `content` array. It is the
base operation for changing links, emphasis, code marks, or mixed marked and
unmarked text. Its node-hash precondition protects the entire previous inline
structure.

`insert_node` identifies only a `destination`, a destination-parent
precondition, and the new node value; there is no existing target node.
`delete_node` uses a target-node precondition plus an `origin` parent and
origin-parent precondition. `move_node` adds a destination and
destination-parent precondition. Protecting the origin prevents a stale
proposal from deleting or moving an unchanged node after another change has
already relocated it. `set_attrs` uses a target-node precondition.

A `destination` contains a parent node and, when needed, a stable sibling
reference. An array index MAY be used only as a fallback when no stable sibling
exists. `before`, `after`, and `index` are mutually exclusive; omitting all
three appends to the parent's children. Detailed containment validation is
defined by the active content profiles.

Every origin or destination precondition MUST be the node hash of the parent ID
named by the corresponding `origin` or `destination`. When a move's origin and
destination name the same parent, both preconditions MUST be identical.

For `set_attrs`, an object `value` completely replaces the node's existing
`attrs` object; it is not a merge patch. A `null` value removes the `attrs`
member. The resulting node MUST still satisfy its content profile, so removing
required attributes is invalid.

## Motivation and delegation

`motivatedBy` links a proposal to annotations that explain why the work exists.
`fulfills` links it to delegations whose requested execution produced the
proposal. A proposal may be motivated by a comment without a formal delegation,
and a delegation may complete without producing a change when the agent instead
reports that no valid change is available.

`request` records direct human direction when no anchored annotation exists. It
is required for genesis because delegation requires a pre-existing target. An
update SHOULD prefer `motivatedBy` and `fulfills` when the work began from a
review selection.

Creating a proposal does not resolve its motivating annotation. Comment,
delegation, and change lifecycle transitions are explicit and independent.

## Conflict handling

Before applying an update, a Change Applier MUST:

1. compare `baseChange` and `baseRevision` with the manifest head and current
   canonical revision;
2. verify every operation's local precondition;
3. validate the proposed result against all declared profiles; and
4. either apply all operations atomically or apply none.

Operations are evaluated and applied in their serialized order against an
isolated working copy. Each operation's preconditions describe the working-copy
state immediately before that operation, so a later operation may intentionally
depend on an earlier one. The working copy becomes canonical only after every
precondition and resulting profile rule succeeds.

If either base differs but every local precondition still holds, the processor
MAY produce an explicit rebased proposal with a new change ID, `baseChange`, and
`baseRevision`. It MUST NOT silently rewrite the existing proposal or treat it
as accepted.

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

The top-level change `status` MUST equal `decision.status`. Only an accepted
decision contains `resultRevision`.

Accepting an update atomically applies its operations, stores its accepted
decision, writes the resulting canonical revision to the manifest, and sets
the manifest's `headChange` to that update's ID.

A policy or service may prevent application or request another proposal, but a
validation outcome is not a portable human decision. DSTAR 0.1 authoring clients
MUST NOT provide a path that serializes a human as the author of canonical
content, including for typo fixes or exact replacement instructions.
