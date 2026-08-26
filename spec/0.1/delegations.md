# Delegations

Status: **Pre-Draft**

A delegation is an explicit assignment of an existing annotation to an agent.
It is separate from the annotation so a person can comment, discuss, or mark an
issue without immediately invoking an agent.

A delegation therefore assumes that canonical content or a projection already
exists and that the source annotation has a portable target. It MUST NOT be used
to initiate a document. Genesis is the sole authoring path without a
pre-existing document target: a human supplies intent and evidence, and an
agent proposes the initial canonical document.

## Storage and record model

Each delegation is stored as `delegations/<delegation-id>.json`. A record
contains:

- a stable delegation ID;
- the annotation that provides its anchored context;
- the assigned agent;
- the human who created the assignment;
- an optional instruction that supplements, but does not replace, the comment;
- a lifecycle status and timestamps; and
- optional typed outputs produced as results.

The annotation remains the portable record of what the person saw and selected.
The delegation MUST NOT replace its target with a natural-language location or
ask the agent to infer that location from the instruction.

## Lifecycle

```text
queued -> in_progress -> completed
  |            |-------> failed
  |--------------------> cancelled
```

The initial status is `queued`. `completed`, `failed`, and `cancelled` are
terminal. A terminal delegation records `completedAt` and `completedBy`. A
failed delegation SHOULD include a diagnostic reason.

Completing a delegation means the assigned execution has ended. It does not
accept a resulting proposal and does not resolve the source annotation. A human
performs those decisions separately.

Reassigning work creates a new delegation ID. Once published, the source
annotation, assignee, creator, instruction, and creation time MUST NOT be
mutated; only lifecycle and result metadata may be added.

## Results

`results` lists zero or more typed outputs:

- `change` references a change proposal; and
- `reply` references a reply in the source annotation thread.

A completed delegation may have no result when the agent determines that no
valid action is possible. In that case it SHOULD include a reason. A reply
result represents an explanation, a request for more direction, or another
non-change outcome.

A resulting change SHOULD include the delegation ID in its `fulfills` field and
the source annotation ID in `motivatedBy`. These reciprocal links make the path
from human selection to agent execution and proposed content explicit.

## Semantic validity

A semantically valid delegation MUST satisfy:

- its filename matches its `id` plus `.json`;
- `annotation` identifies an existing annotation in the package;
- `assignee.type` is `agent`;
- `createdBy.type` is `human`;
- every change result identifies an existing change authored by the assigned
  agent;
- every reply result identifies an existing reply in the source annotation
  authored by the assigned agent;
- a terminal status includes `completedAt` and `completedBy`; and
- a non-terminal status includes neither completion field.
