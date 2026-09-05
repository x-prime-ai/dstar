# Review rounds and host integration

Status: planned product design, 2026-09-04. The
[MVP contract](html-mvp.md) and [architecture](architecture.md) describe current
behavior. This document introduces no supported API or storage schema.

## Product scenario

A reviewer annotates an AI-generated report. The Owner selects three open
comments, adds a general instruction, and requests one revision. The agent
returns a suggested version linked to those comments. The Owner inspects its
changes, accepts or declines it, and returns later to continue the discussion.

Reports, proposals, design explanations and slides are the initial content
types. The same workflow operates on canonical HTML, CSS and local assets.

## Existing foundation and missing experience

| Area             | Implemented                                                                       | Planned                                                                  |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Feedback         | Persistent anchored threads, replies and resolution                               | Select multiple open threads for one revision request                    |
| Agent entry      | CLI, MCP, WebMCP and scoped external handoff; comment actions focus on one thread | Batch handoff and optional host-connected invocation                     |
| Revision context | Exact base and `motivatedBy` links to multiple comments                           | Freeze selected feedback and a general instruction as one review request |
| Review           | Immutable proposals, Before / After, file changes and linked comments             | Easier movement from each comment to relevant local changes              |
| Integration      | Core API and self-hosted Viewer                                                   | A mountable review surface validated in one real host                    |

The existing `motivatedBy` array records motivation. It does not prove that an
agent satisfied a comment or identify an exact changed range for that comment.

## Collect and submit feedback

Open comments gain an explicit selection control for the Owner. The request
composer shows selected comments, their quoted context and a general instruction.
The Owner can remove a comment or change the instruction before sending. Allow
an instruction-only revision request as well; a general instruction belongs to
the request and does not introduce a new whole-document comment anchor type.

A submitted request captures the document, exact accepted base, selected comment
IDs and the reviewed feedback/context. Preserve original comment targets and
their relationship to the current base. Historical comments with ambiguous or
missing anchors must be explained before submission; do not silently attach
them to a different passage.

Revision requests are Owner-only in the reference Viewer. Reviewers continue
to comment, reply and request reply drafts. Selecting comments never grants
revision or decision authority to a Reviewer.

The request is durable before agent invocation. Reopening the document should
show what was submitted and whether a proposal has returned. An expired external
handoff must not erase the submitted request. The implementation must define
the minimal persistence extension and retry identity before adding this UI;
browser-local state alone does not meet this design.

## Invoke an agent

Offer two routes through the same request context:

- An external-agent handoff for users who work in their own agent environment.
- A host-provided invocation hook for products that already run an agent.

The hook belongs in a trusted host integration layer. Core continues to validate
and persist documents without starting agents or managing model credentials.
Provider-specific CLI adapters can be optional wrappers around this boundary;
they are not prerequisites for the review workflow.

The interface should report submitted, running when known, returned and failed
or expired states, and offer an explicit retry. Display only progress the host
can establish. Durable request state does not imply that a process continues
running through a host restart. Reuse logical request identity on retries so
that an ambiguous response does not create duplicate proposals. Do not promise
exactly-once agent execution or duplicate-charge prevention across providers.

## Return and review a suggestion

Both routes ultimately submit a complete HTML/CSS/assets candidate against the
captured base through Core. Core freezes the proposal before any review UI
displays it. Persist its relationship to the request and selected comments;
reuse `motivatedBy` for comment links instead of inferring them from prose.
For instruction-only requests, omit `motivatedBy` rather than submitting an empty
array where the current Core expects a nonempty list.

The Owner sees the suggested version, its explanation and the selected feedback.
From a comment, the UI should lead to its anchor and relevant Before / After
context where that relationship can be established. For CSS, layout or changes
without a precise local mapping, show the available file or full-version
comparison and label the limitation. An agent's claimed explanation is not a
verified mapping of every comment to a specific edit.

Acceptance remains an explicit Owner action against the exact candidate and
current review state. Accepting a proposal leaves comment resolution separate;
selected comments remain open until the Owner resolves them. Declining a
proposal retains the proposal and the feedback for the next attempt.

## Changes while the agent is working

- If the accepted document changes, a result based on the old version cannot
  become current. Explain the conflict and let the Owner prepare a new request
  against the new base; never silently rebase it.
- If discussion changes, retain the submitted feedback snapshot and show that
  newer discussion exists. The agent should not receive a moving request.
- If a selected comment is resolved before proposal submission, current Core
  validation can reject its inclusion in `motivatedBy`. Show an actionable
  failure and let the Owner prepare a new request. Do not weaken that validation
  or silently drop the comment to make the result fit.
- If saving or invoking fails, preserve the feedback and indicate whether the
  request was persisted, invocation is uncertain, or a proposal already exists.

## Reduce integration effort

Start with one real host that has an existing document display and agent entry.
Provide a mountable review surface backed by the existing Core, with a small
host contract for document selection, trusted identity, invocation and result
delivery. Reuse the reference Viewer where practical. Decide whether iframe
embedding, a component or a separate overlay is warranted from this integration.

Authored content remains isolated from review controls and credentials. A
browser save callback must not replace Core proposal validation and acceptance.
The host still operates the filesystem package; a new storage backend is not
part of the embedding milestone.

Measure required host code, setup steps and elapsed time to the first accepted
revision. Record friction from adapting storage and identity as well as UI work.

## Deferred choices

Direct inline edits need a design for their attribution and submission as a
reviewable revision. Canonical Markdown needs renderer/source mapping and writeback
semantics. Neither is required for the first multi-comment review round.

Do not add a new document schema, universal agent orchestration layer or broad
format-support matrix to implement this scenario. The
[roadmap](roadmap.md) defines sequencing and milestone evidence.

## Reference

[MikoMarkup's integration design](https://github.com/snowan/miko-markup/blob/0b46f04ec5b8166b13ca4c4ae2f5529efe9fc4e9/docs/integration.md)
informs the batch-feedback workflow and small host callback boundary. DSTAR
uses those ideas with persistent review context and its existing revision model.
