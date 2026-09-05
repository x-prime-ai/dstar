# DSTAR roadmap

Updated: 2026-09-04. Milestones 1 and 2 are implemented and verified by current
repository automation with a controlled test agent. That evidence is not a real
provider run or host deployment. See the [delivery plan](delivery-plan.md) and
[review-round design](review-rounds.md) for the exact contract.

## Implemented: complete one reference review round

The target scenario is an AI report with three local comments and a general
instruction, one agent revision, explicit Owner review, and a later second round.

### 1. Batch feedback into one revision request — implemented

- Owner selection of multiple current open comments plus an optional general
  instruction.
- Durable exact base, frozen feedback/replies, requester, status and attempt
  identity in the third `records-v1` collection.
- Batch external handoff scoped to one attempt and returned proposal links via
  `requestId`, `proposalId` and `motivatedBy`.
- Persisted failure, expiration and conflict states with explicit retry rules.
- Basic request → proposal and comment → proposal → changes navigation, including
  a labeled fallback when no exact changed element is known.

Current evidence: automated Core and Viewer tests exercise persistence/reopen,
discussion drift, later resolution, stale bases, superseded attempts,
idempotency, Owner/Reviewer boundaries and exact external-handoff return. No
external provider was used for this delivery.

### 2. Connect the host's existing agent — implemented contract

- Optional trusted-host `agentInvocation` callback over the same frozen request
  and exact base files.
- Durable submitted/running/returned/failed/conflicted state plus timeout and
  retry handling.
- Provider configuration, credentials, billing and execution remain outside
  Core and Viewer persistence.

Current evidence: automated loopback HTTP tests use a controlled callback to
return a candidate, force a timeout, retry with a new attempt and reconcile the
stored proposal without duplication. This verifies the callback contract, not a
real provider integration, production process lifecycle or duplicate-charge
behavior.

## Next: lower real integration effort

### 3. Validate a mountable review surface in one real host — not implemented

- Reuse Core and reference review behavior inside an existing product.
- Document the smallest working identity, document, origin and invocation
  contract.
- Record host setup, adapter work and time to first accepted revision.

Exit evidence: a real host completes two review rounds at its own origin with
host-owned data, identity and real provider execution. Document remaining
storage and deployment effort. Choose the embedding mechanism from that evidence
before publishing an independent overlay package. An in-repository controlled
agent or compile-checked example cannot satisfy this milestone.

### 4. Deepen comment-to-change inspection

The first navigation slice is implemented. Continue only from observed review
friction:

- improve local Before/After navigation beyond stable-element HTML changes;
- explain unlocated anchors and CSS/layout changes without claiming semantic
  proof; and
- validate narrow screens and keyboard movement in the real-host scenario.

Exit evidence: reviewers can connect the three comments, changes, decision and
remaining discussion without source inspection. Acceptance and resolution stay
distinct.

## Validation measures

Establish a baseline in the target real host, then repeat the same report and
review tasks. These are planned measurements; no achieved numeric result is
asserted by the repository tests.

| Measure                 | Record                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| First accepted revision | Host setup steps, integration work, elapsed time and agent execution time separately             |
| Round friction          | Manual copy/paste, context re-entry and application switches                                     |
| Review comprehension    | Whether the reviewer connects feedback, changes, decision and unresolved work without assistance |
| Continuity              | Whether a returning user or another authorized reviewer can continue after reopening             |

## Deferred until a concrete need

| Work                                                          | Trigger for reconsideration                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Direct inline editing                                         | Repeated small manual corrections justify an attributed revision workflow               |
| Markdown import                                               | A target host needs Markdown input converted to canonical HTML                          |
| Canonical Markdown                                            | A target host must retain `.md` authority and can validate source mapping and writeback |
| Independent overlay SDK                                       | Real-host evidence demonstrates a reusable boundary beyond Viewer                       |
| Generic storage backend                                       | A target host cannot operate the filesystem package and supplies concrete requirements  |
| Stable specification and interoperability vectors             | An independent consumer needs a stable cross-implementation contract                    |
| Search, pagination, retention/GC and streamed materialization | Measured document/history sizes hit current usability or runtime limits                 |
| Broader identities and deployment models                      | A target integration exceeds fixed roles or single-writer filesystem assumptions        |
| Advanced slide sizing and cross-element selections            | Review tasks show current presentation or selection limits block completion             |

## Ongoing correctness work

Preserve exact revisions, immutable proposals, durable request snapshots,
explicit Owner decisions, independent comment resolution and isolated content.
Broader adversarial HTML/CSS/browser coverage, cross-platform crash testing and
safe abandoned-lock recovery remain backlog items until a concrete defect or
target deployment requires them.
