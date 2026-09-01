# Demo script — target 2:35

The final recording must remain under three minutes, include audible narration,
show the live deployed project, and avoid copyrighted music or unlicensed
third-party material.

## 0:00–0:20 — Problem

**Screen:** Open the DSTAR document library, then a product brief.

**Narration:**

> Agents can create a document in seconds, but reviewing it still means copying
> text into chat and losing the exact version you meant. DSTAR keeps the agent
> and the person in the same review context.

## 0:20–0:42 — Product model

**Screen:** Show the current document, Comments and Versions. Briefly switch to
the slide example to show that formats remain ordinary HTML.

**Narration:**

> DSTAR stores one canonical HTML, CSS and local asset set. A regular document,
> a designed page and slides are layouts of the same artifact. Comments stay
> anchored to exact revisions, and Versions is one understandable timeline.

## 0:42–1:20 — Live page context

**Screen:** Select one sentence, choose Comment, then Ask agent. Show WebMCP tool
discovery and call `get_review_context` in the external agent.

**Narration:**

> The Viewer exposes role-scoped WebMCP tools. Because this is page context, the
> agent receives the exact displayed revision, Unicode selection and action I
> just chose. I can simply say “draft a concise comment” without pasting the
> sentence, a revision hash or a comment ID.

**Screen:** Return to the Viewer, show the editable draft, adjust one word and
post it manually.

> The agent prepares the draft, but it cannot post for me.

## 1:20–2:05 — Agent proposal, human decision

**Screen:** Focus the comment, choose Ask agent, and ask it to update the
document. Show `read_document` and `propose_revision`, then return to Viewer.

**Narration:**

> Now I ask the agent to address this thread. It reads the immutable document
> and proposes a complete replacement against the exact accepted base. The
> current document does not change.

**Screen:** Open Versions, compare the pending revision, and explicitly accept
or reject it.

> The proposal is linked to the comment and appears for review. DSTAR never
> gives the agent accept, reject or resolve tools. Publishing remains a human
> decision.

## 2:05–2:28 — Why WebMCP

**Screen:** Show the tool list beside the Viewer and the Owner/Reviewer role
labels.

**Narration:**

> A normal MCP server can read stored files. WebMCP adds what matters here: what
> the person is viewing, selecting and trying to do now. DSTAR combines that
> live context with narrow capabilities, exact revisions and visible human
> control.

## 2:28–2:35 — Close

**Screen:** DSTAR title and live URL.

**Narration:**

> DSTAR: expressive enough for agents, clear enough for everyone.
