# Review-round delivery plan

Status: authorized for implementation, 2026-09-04. This plan operationalizes the
[roadmap](roadmap.md) and [review-round design](review-rounds.md); planned features
remain unavailable until implementation and verification are recorded.

## First delivery

Implement roadmap milestones 1 and 2: durable multi-comment revision requests,
batch external handoff, and optional host-connected agent invocation. Include
the basic comment/proposal navigation necessary to review that batch. Keep the
current static HTML/CSS/assets format and exact Owner decision boundary.

Update the public guides, API references, design contracts and implementation
status alongside code. Preserve the distinction between implemented behavior,
tested examples and a real external host deployment. Milestone 3 requires a real
host integration; an in-repository example alone cannot mark it complete.

## Session ownership

Use separate Codex tasks with model `gpt-5.6-sol` and reasoning effort `high`.
Each editing task works in an isolated Git worktree based on the documentation
checkpoint. One delivery lead owns architecture, implementation, integration,
documentation accuracy and the final merge. A parallel verification task
inspects the current baseline, prepares acceptance scenarios, and independently
reviews the implemented diff. The lead can split implementation further when
file ownership and interfaces are explicit.

The lead coordinates cross-task messages and completion waits. Shared API and
persistence contracts must be agreed before dependent implementations diverge.
Independent tasks do not merge to `main`; they report commits and findings to
the lead. Every additional task uses the same requested model and effort.

## Review and verification

Each implementation task performs a self code review after implementation,
fixes actionable findings, and reruns affected checks. The delivery lead then
reviews the integrated change and incorporates the independent review. Document
findings and their disposition, including any unresolved limitations.

Verify the report scenario with three comments and one general instruction,
reopening before and after proposal return, explicit accept/reject, a second
round, stale bases, comment changes/resolution during execution, role limits,
invocation failure and retry. Exercise both external handoff and a connected
host adapter. Use controlled agents for deterministic tests and label them as
such; do not describe simulated execution as a live provider run.

Run relevant unit/integration and browser checks, then the repository's required
verification suite on the integrated result. Resolve regressions before merge.
Record any environmental verification limit accurately; never suppress a failed
check or weaken a test solely to obtain a passing result.

## Merge and handoff

The user has authorized the final merge into local `main`. Before merging,
recheck the target branch and worktree, preserve unrelated changes, and integrate
any intervening commits. Use normal commits and a non-destructive merge; do not
rewrite history or force-push. Publishing or production deployment is outside
this delivery.

The delivery lead owns the task through implementation, docs, review/fixes,
verification and merge. Its final report names the resulting main commit,
delivered features, checks and remaining roadmap work. Update this plan's status
and the roadmap to match actual evidence, without treating future milestones as
complete.
