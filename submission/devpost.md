# DSTAR — Devpost draft

## Tagline

Review agent-created documents in the document itself, with exact context,
human decisions and portable history.

## Short description

DSTAR is an HTML-first document review workspace where an external browser
agent can read the exact version and selection a person is viewing, draft
contextual feedback, and propose a complete revision. People keep control of
posting comments, accepting changes, resolving threads and publishing the
current version.

## The problem

Agents can generate polished documents quickly, but review still falls apart
across chat transcripts, copied excerpts and replacement files. The reviewer
loses the exact sentence and version they meant. The agent loses the live state
of the page. The Owner receives an opaque final file without a trustworthy
record of comments, revisions and decisions.

## What DSTAR does

DSTAR keeps one canonical artifact: HTML, CSS and local assets. The Viewer
renders conventional documents, rich web documents, slides and UI design specs
without introducing a parallel source format. Reviewers can select exact text,
open comment threads and reply. The Owner can ask an external agent to update
the document, inspect the proposed version, and explicitly accept or reject it.
Every proposal is immutable and based on an exact accepted revision.

## Why WebMCP is essential

A conventional MCP server can expose a stored document, but it does not know
what the person is looking at in the browser right now. DSTAR's page tools bind
the external agent to the live Viewer state: the exact displayed revision,
selected Unicode range, focused comment, current role and the action the person
chose. That lets the agent act on phrases such as “rewrite this” or “help me
reply” without making the person copy text, hashes or comment IDs into chat.

WebMCP also preserves the right trust boundary. The page exposes narrow,
role-scoped tools while keeping final human decisions out of the agent toolset.
The agent may prepare an editable comment or reply draft and may store an Owner
revision proposal, but it cannot post that draft, accept or reject a revision,
or resolve a thread.

## What people and agents do together

1. A person reads the document and selects text or focuses a comment.
2. The Viewer records that transient context and creates a short-lived scoped
   handoff when the person chooses Ask agent.
3. The external agent reads the exact review context and immutable document.
4. The agent returns an editable comment/reply draft or submits a complete
   revision proposal linked to the comment it addresses.
5. The person reviews the result in place and explicitly posts, accepts,
   rejects or resolves it.

The page context removes repetitive prompting, while immutable revisions and
human-only decisions keep the workflow understandable and auditable.

## WebMCP implementation

The authenticated top-level Viewer registers role-scoped tools with
`document.modelContext.registerTool`. Tool execution crosses a restricted JSON
bridge into the DSTAR Engine. The sandboxed authored document receives no tool
permission.

The public static demo exposes these page tools:

- `get_review_context` — reads the exact displayed version, selection, focused
  comment, role, proposals and comment threads.
- `read_document` — reads a complete immutable HTML/CSS/local asset file set at
  an exact revision.
- `draft_selection_comment` and `draft_comment_reply` — return editable drafts
  to the matching Viewer composer without posting them.
- `propose_revision` — Owner only; validates and stores a complete candidate
  against the exact accepted base without publishing it.

The repository's persistent Viewer applies the same trust boundary over the
filesystem-backed Engine, with keyed replies, role-bound sessions and
reopenable history.

Registration is abortable and restored after page lifecycle changes. Inputs
reject unknown properties. Document and comment content is treated as untrusted
data. Credentials, host paths and frame capabilities never appear in tool
arguments or results. Mutation routes require the authenticated role, exact
Origin, JSON content type, resource bounds and idempotency keys.

## Product experience

The default view is the current document. Comments behave as open or resolved
threads anchored to the exact revision. Versions use one chronological list.
Slides automatically receive a thumbnail rail and keyboard navigation from the
Viewer. Owner and Reviewer links expose different capabilities, and every
agent result returns to a visible editable or reviewable state rather than
silently changing the document.

## Built during the challenge

DSTAR had a small vision/specification draft before the submission period. The
working HTML-first Engine and Viewer, WebMCP tools and restricted bridge,
role-bound collaboration, external-agent handoffs, online workspaces, sample
document library and current review experience were implemented during the
submission period. Exact dated commits are documented in
[development-window.md](development-window.md).

## Testing

The repository includes unit, integration, security and conformance coverage.
The Viewer tests use real loopback HTTP servers, filesystem persistence and
process restarts. We also exercised real tool discovery and calls through the
ChatGPT in-app browser without injecting a WebMCP polyfill. The public static
demo uses the same exact-revision and human-decision model while storing its
sample state in the visitor's browser.

## Links

- Devpost submission: https://devpost.com/software/dstar
- Live project: https://www.thinkofu.ai/dstar/
- Demo video: https://youtu.be/v66wnIOBoZU

## Judge testing instructions

1. Open https://www.thinkofu.ai/dstar/ in ChatGPT's in-app browser or WebMCP-enabled
   Chrome.
2. No access credentials are required. Each sample keeps its comments and
   version history in the current browser only; use a fresh browser profile to
   start clean.
3. Open any sample document and confirm the page exposes
   `get_review_context`, `read_document`, `draft_selection_comment`,
   `draft_comment_reply`, and `propose_revision`.
4. Select a sentence in the document. Ask the external agent to read the page
   context and draft a concise comment with `draft_selection_comment`. Return
   to the Viewer, edit the draft and post it explicitly.
5. Ask the agent to read the exact current revision, revise the complete HTML
   and CSS, and call `propose_revision`. The result appears under Versions as a
   pending suggestion while the displayed current version remains unchanged.
6. Open the pending suggestion, review it, and click Accept update or Reject
   yourself. The agent has no decision tool and cannot resolve the comment.
