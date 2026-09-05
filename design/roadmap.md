# DSTAR roadmap

Updated: 2026-09-04. The DSTAR standalone Core, CLI, MCP and Viewer delivery is
implemented and verified by current repository automation with a controlled
test agent. That evidence is not a real provider run or external product
deployment. Cross-product host/provider validation is deferred and does not
block standalone delivery. See the [delivery plan](delivery-plan.md) and
[review-round design](review-rounds.md) for the exact evidence boundary.

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

## Implemented: standalone integration surfaces

### 3. Mountable review and public package readiness — implemented

- Public `@dstar/core`, `@dstar/mcp` and `@dstar/viewer` entry points and
  TypeScript declarations.
- A base-path-safe Viewer mount with credential-free readiness, returned
  `baseUrl`/`healthUrl`, and host-facing identity/origin/invocation guidance.
- Clean packed-package import smoke plus a compile-checked TypeScript consumer.
- A useful standalone path when `agentInvocation` is absent: durable requests
  can use scoped external handoff; Core and MCP can return request-linked
  proposals, while the repository CLI can submit ordinary proposals.

Current evidence: repository tests cover path-mounted assets/API/health,
identity and origin rejection, callback absence/presence, refresh, restart
reconciliation and repeated review rounds over durable state. The release check
packs and imports all three public packages from a clean consumer layout.

This makes the standalone integration contract deliverable without selecting a
different product. It does not claim a real provider, TLS deployment,
host-specific identity adapter or cross-product user study.

### 4. Deepen comment-to-change inspection — repository slice implemented

The first navigation slice is implemented. Continue only from observed review
friction:

- improve local Before/After navigation beyond stable-element HTML changes;
- explain unlocated anchors and CSS/layout changes without claiming semantic
  proof; and
- validate narrow screens and keyboard movement in the real-host scenario.

Current repository evidence: missing/ambiguous anchors, CSS/layout changes,
assets and generic fallbacks now have explicit, non-semantic navigation;
Before/After and changed-file focus are keyboard-operable; and controlled
browser checks passed at desktop and 390 px. Unlocated discussions remain
inspectable without being submitted as uninterpretable revision feedback.
These are controlled repository-level usability findings, not
external-product user evidence.

Exit evidence: reviewers can connect the three comments, changes, decision and
remaining discussion without source inspection. Acceptance and resolution stay
distinct.

## Deferred cross-product validation

A future integration may establish a baseline in a selected external product,
then repeat the same report and review tasks with its real identity, data and
provider execution. These are optional planned measurements; no achieved
numeric result is asserted by repository tests, and this work is not part of
the standalone completion criteria.

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
| External-product/provider validation                          | A separate integration explicitly selects a host, provider and success measures         |

## Ongoing correctness work

Preserve exact revisions, immutable proposals, durable request snapshots,
explicit Owner decisions, independent comment resolution and isolated content.
Broader adversarial HTML/CSS/browser coverage, cross-platform crash testing and
safe abandoned-lock recovery remain backlog items until a concrete defect or
target deployment requires them.
