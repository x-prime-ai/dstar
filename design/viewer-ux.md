# Viewer information architecture

Status: implemented for the HTML-first Viewer.

The Viewer is a reading and review surface. It preserves the Engine's exact
revision, comparison, anchor and decision guarantees without asking a reader to
understand the storage model.

## UX audit

The previous desktop and narrow layouts were tested with a current document and
a pending change. Four problems dominated:

1. The default page hid the pending task behind a small count, so a reader could
   not tell what needed attention.
2. Versions mixed a selected revision, `To review`, accepted history, rejected
   proposals and truncated hashes. The list mirrored internal state instead of
   the reader's timeline.
3. A pending change used `Proposed changes`, `pending`, `Changes`, and `Show
base` at once. The user had to infer which document was on screen.
4. Preview and Changes appeared as global navigation even though Preview was
   simply the document and a diff only belongs to one selected version.

## Primary information architecture

The interface has three user tasks:

- **Read** the current document. This is always the default when a current
  version exists.
- **Comments** as independent, collapsible threads. Each root comment and its
  replies share one Open or Resolved state. The document uses quiet yellow
  highlights without markers and a distinctly stronger amber treatment for
  the selected thread; user icons stay inside the thread list.
- **Versions** as one newest-first list. Each row identifies its status, author,
  date and change size without splitting the history into separate sections.

A pending item opens a contextual review of that version. Its header answers:
what is proposed, who proposed it, how much changed and what to do next. The
document remains the default canvas; a diff is available only from the selected
version's **View changes** action. Before / After replaces `Show base`; Accept /
Reject stays visible in the document and diff views.

## Terminology mapping

| Internal contract                  | User-facing UI                                             |
| ---------------------------------- | ---------------------------------------------------------- |
| accepted head                      | Current version                                            |
| pending proposal / candidate       | Suggested change                                           |
| accepted non-head proposal         | Previous version                                           |
| rejected proposal                  | Declined suggestion                                        |
| base preview                       | Before                                                     |
| candidate preview                  | After                                                      |
| proposal diff                      | View changes / What changed                                |
| stale base                         | Based on an earlier version; ask for an updated suggestion |
| revision, base hash, storage delta | Technical details                                          |

These mappings are presentation-only. API payloads, exact revision checks and
Engine terminology do not change.

## Interaction and feedback states

- The header shows the document name, Current/Suggested/Previous status and the
  only two activity tabs: Comments and Versions. Their counts expose open work
  without a separate Review layer.
- Selecting text exposes named Comment and Suggest actions. Whole-element
  selection is described without exposing `data-dstar-id`. Canceling either
  composer clears its draft, target and native document selection.
- Clicking a comment thread selects and reveals its anchor in the document.
  Thread cards do not repeat the selected document text, and replies never
  receive a separate status from their thread. Thread summaries show only a
  user icon, author, time and status; each reply also has a user icon. One
  thread is expanded at a time, and its root comment and replies form one
  unindented chronological stream. Replies use the same flat content format as
  the root comment, separated only by a quiet divider rather than nested cards.
- The Comments panel defaults to Open and offers an Open / Resolved filter with
  counts. Each filter contains only threads that belong to the viewed version
  or a located descendant; unresolved historical, declined or orphaned anchors
  do not leak into the current-version list.
- Agent work uses one local status region with `idle`, `waiting`, `returned` and
  `expired` states. Returned text is always an editable draft; it is never
  posted or accepted automatically.
- An exact ready After preview enables acceptance. Before disables acceptance.
  Stale suggestions remain inspectable and rejectable but cannot be accepted.
- Empty states explain the next action: start a conversation or create the
  first version.

## Responsive and accessible behavior

Comments / Versions live in the top header and toggle the adjacent activity
panel. Desktop keeps the open panel alongside the document. Tablet and phone
overlay it; phone uses the full available width. Clicking the active tab again
collapses the panel. The document, contextual exact-diff view and decision bar
remain in one reading order. The tabs use roving focus and arrow keys,
selection actions have visible names and accessible labels, status changes use
live regions, modal decisions retain explicit confirmation, and focus returns
to the invoking surface.

The implemented flow was Browser-checked at 1440×900, 820×1024 and 390×844.

## Composition contracts

- Roles are consumed through `ViewerSession.can(capability)` and public
  `session.identity`; the server remains the authorization boundary.
- Comment-agent UI composes into `.comment[data-comment]` using
  `.comment-address-agent`, `.reply-composer`, `.linked-proposals`,
  `#version-addresses` and the shared agent status region.
- Workspace create/reset stays outside the Viewer. A future
  `workspaceManagementUrl` is an Owner-only link, not an embedded lifecycle API.
- `viewer-model.js` owns presentation groups, labels, actor display and the
  single technical revision string so the main event/controller module does not
  duplicate Engine state rules.
