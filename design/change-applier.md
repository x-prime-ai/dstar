# Change Applier

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## Purpose and authority

The Change Applier is the deterministic gate between a complete pending
candidate and canonical package state. It validates the exact candidate,
computes review and storage representations, records an explicit human
decision, and atomically advances the accepted head. It never chooses content
or decides on behalf of a person.

Proposal authorship and decision authority are independent. A human or service
actor may author a proposal. Only an authorized human actor may accept, reject,
or supersede it.

## Candidate contract

An update proposal contains:

- exact `baseChange` and `baseRevision`;
- the complete candidate canonical file set or references to staged bounded
  files;
- actor, request, motivation, and source provenance;
- candidate revision computed from the complete result; and
- derived storage patches and review diff, which can be recomputed and are not
  trusted from the caller.

Agents submit complete candidates because arbitrary HTML and CSS design is more
expressive than a universal portable DOM-operation vocabulary. DSTAR derives
the compact accepted history itself.

## Simulation

Simulation is pure for one snapshot and candidate. It returns `applicable`,
`stale-base`, `invalid`, or `unsafe`, together with diagnostics, the exact
candidate revision, before/after preview handles, semantic review diff, asset
inventory changes, and proposed storage entries.

Validation proceeds in this order:

1. verify the proposal state, actor, references, and explicit base;
2. require the declared base to equal the current accepted head;
3. inventory candidate files with resource limits and path containment;
4. parse and validate HTML, CSS, URLs, assets, and stable IDs;
5. require all meaningful candidate content to be review-addressable;
6. compute the complete candidate revision;
7. compute a DOM-, CSS-, and asset-aware review diff;
8. select exact-base patches or replacement blobs for physical history; and
9. replay the selected storage representation and require its result to equal
   the candidate revision.

Unsafe input is rejected rather than silently sanitized after preview. A
candidate preparation tool may normalize formatting before submission, but the
bytes shown to the reviewer are the bytes accepted.

## Review diff

The review diff is keyed primarily by stable `data-dstar-id` values. It reports:

- inserted, removed, and moved elements;
- text changes at Unicode code-point ranges;
- meaningful attribute and accessibility changes;
- class and inline-style changes;
- stylesheet and custom-property changes;
- asset additions, removals, and reference changes; and
- the fraction of meaningful DOM rewritten or stripped of stable identity.

A raw line diff may be available for inspection but is not the primary human
explanation. A high rewrite ratio is a visible warning because it increases
review cost and comment-anchor loss; it does not block an intentional redesign.

## Storage change

A portable accepted change records the exact transition without requiring full
snapshot duplication:

```ts
interface FileChange {
  path: PackagePath;
  operation: "add" | "modify" | "delete";
  baseDigest?: Digest;
  resultDigest?: Digest;
  storage: PatchReference | BlobReference;
}

interface AcceptedChange {
  id: ChangeId;
  parent: ChangeId | null;
  baseRevision: Revision | null;
  resultRevision: Revision;
  files: readonly FileChange[];
  proposal: ProposalProvenance;
  decision: HumanDecision;
}
```

Patches require exact base bytes. They never use line-context guessing. Asset
objects are content-addressed and reused across versions.

## Decisions

Acceptance requires a fresh snapshot, matching base, human actor, clean
simulation, exact candidate revision, verified storage replay, strict package
validation, and a matching or unused idempotency key.

One recoverable transaction writes the new current canonical files, immutable
objects, accepted change and decision, and matching manifest head. Rejection
and supersession update proposal state only.

Genesis follows the same boundary without a parent revision. Its complete
candidate becomes the initial checkpoint or replacement object set after a
separate human acceptance.

## Historical materialization

To materialize a version, the runtime:

1. chooses genesis or the nearest verified ancestor checkpoint;
2. applies each accepted file change in parent order;
3. verifies every file result digest and complete document revision;
4. validates the materialized HTML package; and
5. returns immutable bytes labeled with the accepted change and revision.

Current comments are not rewritten into a historical snapshot. The review
client resolves each comment against the version it originally targeted and may
also attempt explicit recovery at the current head.

## Tests

- full candidate validation and deterministic result revisions;
- DOM/CSS/asset review-diff fixtures;
- text and binary patch round trips;
- patch-versus-blob storage selection;
- stale bases, no fuzzy application, and no silent rebase;
- exact-result human decisions and idempotent retry;
- large intentional redesigns and rewrite-ratio warnings;
- genesis, checkpoints, and accepted-chain materialization; and
- corrupted patches, objects, checkpoints, and manifest/head mismatches.
