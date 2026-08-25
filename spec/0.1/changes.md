# Changes

Status: **Pre-Draft**

A change is a reviewable proposal to transform one canonical document revision
into another.

## Change record

A change contains:

- a stable change ID and idempotency key;
- the canonical revision against which it was authored;
- its author;
- one or more ordered operations;
- an initial `proposed` status;
- optional links to annotations and sources that motivated it; and
- an explicit decision when no longer proposed.

Once published, the proposal payload — base revision, author, motivations, and
operations — MUST NOT be mutated. A later proposal that changes those fields has
a new change ID. Status and decision metadata may be added by an authorized
Change Applier.

## Operations

Every operation contains:

- a stable operation ID;
- an operation type;
- a stable target node ID;
- a local precondition; and
- operation-specific values.

The base operation vocabulary is:

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

## Conflict handling

Before applying a change, a Change Applier MUST:

1. compare `baseRevision` with the current canonical revision;
2. verify every operation's local precondition;
3. validate the proposed result against all declared profiles; and
4. either apply all operations atomically or apply none.

If the base revision differs but every local precondition still holds, the
processor MAY produce an explicit rebased proposal with a new change ID and
base revision. It MUST NOT silently rewrite the existing proposal or treat it as
accepted.

The processor reports a stale base separately from a local target conflict.

## Idempotency

Repeating an application request with the same `idempotencyKey` MUST NOT apply
the operations more than once. An implementation MAY retain a local operation
ledger, but the accepted change and resulting revision remain portable records.

## State and decision model

```text
proposed -> accepted
proposed -> rejected
proposed -> superseded
```

Every non-proposed change has a `decision` containing the deciding actor,
timestamp, and optional reason. An accepted decision additionally records the
resulting canonical revision.

An agent-authored change MUST NOT be accepted solely by the same agent. A
rejected or superseded change does not modify canonical content.
