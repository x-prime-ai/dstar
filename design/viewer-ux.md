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
4. On a phone, choosing a pending version closed the rail; opening Changes
   required reopening it, and the Changes screen hid the decision actions.

## Primary information architecture

The interface has three user tasks:

- **Read** the current document. This is always the default when a current
  version exists.
- **Comments** to discuss or suggest changes at a precise selection.
- **Versions** as one chronological model: Suggested changes, Current version,
  Previous versions. Declined suggestions remain available as secondary
  history.

A pending item opens **Review changes**, a mode rather than another version
concept. Its header answers: what is proposed, who proposed it, how much changed
and what to do next. Preview and Changes are two views of the same review.
Before / After replaces `Show base`; Accept / Reject stays visible in both views.

## Terminology mapping

| Internal contract                  | User-facing UI                                             |
| ---------------------------------- | ---------------------------------------------------------- |
| accepted head                      | Current version                                            |
| pending proposal / candidate       | Suggested change                                           |
| accepted non-head proposal         | Previous version                                           |
| rejected proposal                  | Declined suggestion                                        |
| base preview                       | Before                                                     |
| candidate preview                  | After                                                      |
| proposal diff                      | Changes / What changed                                     |
| stale base                         | Based on an earlier version; ask for an updated suggestion |
| revision, base hash, storage delta | Technical details                                          |

These mappings are presentation-only. API payloads, exact revision checks and
Engine terminology do not change.

## Interaction and feedback states

- The header shows the document name, Current/Suggested/Previous status and a
  direct Review changes action when work is waiting.
- Selecting text exposes named Comment and Suggest actions. Whole-element
  selection is described without exposing `data-dstar-id`.
- Comment focus remains explicit in both the rail and the sandboxed document.
- Agent work uses one local status region with `idle`, `waiting`, `returned` and
  `expired` states. Returned text is always an editable draft; it is never
  posted or accepted automatically.
- An exact ready After preview enables acceptance. Before disables acceptance.
  Stale suggestions remain inspectable and rejectable but cannot be accepted.
- Empty states explain the next action: start a conversation, all caught up, no
  current version, or no previous versions.

## Responsive and accessible behavior

Desktop keeps the Comments / Versions rail alongside the document. Tablet and
phone use an overlaid rail; phone uses the full available width. Review summary,
Preview / Changes and the decision bar remain in one reading order. Tab lists
use roving focus and arrow keys, selection actions have visible names and
accessible labels, status changes use live regions, modal decisions retain
explicit confirmation, and focus returns to the invoking surface.

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
