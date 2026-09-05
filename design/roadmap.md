# DSTAR roadmap

Updated: 2026-09-04. This is the product priority order, not a release schedule
or a claim of delivered features. See [implementation status](implementation-plan.md)
for shipped foundations and [review-round design](review-rounds.md) for the
planned interaction and integration boundaries.

Milestones 1 and 2 are authorized as the first implementation delivery. See the
[delivery plan](delivery-plan.md) for session ownership, review and merge criteria.

## Next: complete one review round

The target scenario is an AI report with three local comments and a general
instruction, one agent revision, explicit Owner review, and a later second round.

### 1. Batch feedback into one revision request

- Add Owner selection of multiple open comments and a general instruction.
- Persist the submitted base and feedback context with retry identity.
- Extend external handoff to carry that batch; link returned proposals to the
  request and selected comments using existing `motivatedBy` semantics.
- Preserve failed requests and feedback, with clear retry and stale-base states.

Exit evidence: complete the target scenario with an external agent; reopen
after submission and after acceptance; verify the request, linked proposal,
history and unresolved comments remain understandable. Include a competing
accepted revision and a comment resolved during execution. No stale result can
be accepted, and no selected feedback is silently discarded.

### 2. Connect the host's existing agent

- Add a small optional host invocation boundary over the same review request.
- Surface known progress, result and failure, with explicit retry behavior.
- Keep provider configuration and execution in the host or optional adapters.

Exit evidence: one host-connected agent completes the same scenario without
manually pasting a handoff. Both routes preserve the same proposal and Owner
decision boundaries. An ambiguous invocation response can be reconciled without
duplicating the stored proposal; reopening shows durable request state even if
execution was interrupted.

## Then: lower integration and review effort

### 3. Validate a mountable review surface in one real host

- Reuse Core and the reference review behavior inside an existing product.
- Document the smallest working identity, document and invocation contract.
- Record host setup, adapter code and time to first accepted revision.

Exit evidence: a real host completes two review rounds at its own origin with
host-owned data and identity. Document remaining storage and deployment effort.
Choose the embedding mechanism from that evidence before publishing an
independent overlay package. No generic storage abstraction is required here.

### 4. Make comment-to-change inspection easier

- Improve navigation from selected feedback to the proposal and local
  Before / After context.
- Explain unlocated anchors and changes that only have a file/full-version view.
- Keep resolution distinct from acceptance and an agent's claim of completion.

Exit evidence: a reviewer can inspect the three comments, identify what changed,
accept or decline the revision, and identify remaining discussion without
opening source files. Validate text and CSS/layout edits, narrow screens and
keyboard navigation. Small navigation improvements can ship with milestone 1;
do not wait for a semantic CSS diff system.

## Validation measures

Establish a baseline using the current Viewer, then repeat the same report and
review tasks after each milestone. These are planned measurements; no numeric
targets or achieved results are asserted yet.

| Measure                 | Record                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| First accepted revision | Host setup steps, host integration work, elapsed time and agent execution time separately           |
| Round friction          | Manual copy/paste, context re-entry and application switches                                        |
| Review comprehension    | Whether the reviewer can connect feedback, changes, decision and unresolved work without assistance |
| Continuity              | Whether a returning user or another authorized reviewer can continue after reopening                |

Use observed friction to adjust the next milestone. A shorter prompt or fewer
packages is useful only when it makes completing the review round easier.

## Deferred until a concrete need

| Work                                                          | Trigger for reconsideration                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Direct inline editing                                         | Repeated small manual corrections justify an attributed revision workflow               |
| Markdown import                                               | A target host needs Markdown input converted to canonical HTML                          |
| Canonical Markdown                                            | A target host must retain `.md` authority and can validate source mapping and writeback |
| Independent overlay SDK                                       | The real host integration demonstrates a reusable boundary beyond the Viewer            |
| Stable specification and interoperability vectors             | An independent consumer needs a stable cross-implementation contract                    |
| Search, pagination, retention/GC and streamed materialization | Measured document/history sizes hit current usability or runtime limits                 |
| Broader identities and deployment models                      | A target integration exceeds fixed roles or single-writer filesystem assumptions        |
| Advanced slide sizing and cross-element selections            | Review tasks demonstrate that current presentation or selection limits block completion |

## Ongoing correctness work

Fix discovered data-loss, authorization, validation and recovery defects as they
arise. Preserve exact revisions, immutable proposals, explicit Owner decisions,
comment origins and isolated content throughout the roadmap.

Broader adversarial HTML/CSS/browser coverage, cross-platform crash testing and
safe abandoned-lock recovery remain engineering backlog items. They move ahead
when a concrete defect or target deployment requires them. Existing guarantees
are requirements for every milestone; a new feature must not bypass them.
