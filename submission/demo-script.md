# DSTAR demo script

- **Target length:** 1:45–1:55
- **Language:** English narration and English agent prompts
- **Format:** DSTAR Slides introduce each chapter, followed immediately by the matching live product action.

## Main story

AI changed document creation before it changed collaboration. Agents can already create polished documents, explainers, slides, and UI designs, but people still review those artifacts in disconnected tools. Comments lose the page context that gave them meaning, and revisions return as replacement files.

That is why we built DSTAR. The name is pronounced **D-star**: `D` means document and the star is a wildcard for any document form an agent can create. DSTAR uses HTML, CSS, and local assets as one expressive artifact model, then adds comments, versions, and explicit human decisions above it.

The demo proves one loop on the Slides document itself:

**understand the problem → see the common format → create with an external agent → comment on the live slide → let the agent propose a revision → let the Owner accept it → explain why WebMCP matters**

## Final narration and shots

### 0:00–0:20 — Why DSTAR exists

**Screen:** Show Slides 1 and 2 full-screen. Keep each slide visible long enough to read the headline; do not show the Viewer controls yet.

**Narration:**

> AI agents can create polished documents in seconds. But reviewing them? That still happens across disconnected editors, slide tools, design files, and chat. Comments lose context. Revisions become replacement files. That's why we built DSTAR: one place to review every artifact an agent can create.

### 0:20–0:40 — The idea and the four formats

**Screen:** Show Slides 3 and 4. Then cut briefly through the four real samples: Document, Rich HTML, Slides, and UI design.

**Narration:**

> D-star means document star. D is document; star is the wildcard: any form an agent can create. Underneath, it's one HTML-based format. It can be a traditional document, a rich explainer, a slide deck, or a UI design spec. And comments and versions work the same way across all four.

### 0:40–1:00 — Create with an external agent

**Screen:** Show Slide 5. In Documents, start a new document with a title, format, and brief. Copy the handoff, switch to a compatible external agent, and show only the completed WebMCP result. Return to DSTAR and open the created document.

**Prepared fields:**

- Title: `DSTAR launch note`
- Format: `Document`
- Brief: `Explain why live page context and human publishing control matter. Include a short three-step workflow and a comparison table.`

**Agent instruction:**

> Open the DSTAR creation handoff, create the requested document, and return it to DSTAR.

**Narration:**

> Here, I give DSTAR a title, a format, and a brief. Then I ask my external agent to create it. Through WebMCP, the agent reads the exact request and returns the complete artifact, straight into the review space. I never copy generated HTML through chat.

### 1:00–1:16 — Draft a comment on the Slides document

**Screen:** Show Slide 6. In the real Slides Viewer, select the prepared sentence and choose **Comment → Ask agent**. Cut to a compatible external agent after its WebMCP calls complete. Return to DSTAR, show the editable draft, and explicitly click **Post comment**.

**Agent instruction:**

> Draft a concise comment asking the author to make clear that comments and version history work consistently across every document format. Return the draft, but do not post it.

**Narration:**

> Now I select the exact text on this slide and ask my agent to draft a comment. The page gives the agent two things: the live selection, and what I'm trying to do. The draft comes back to DSTAR. I can edit it, and I decide whether to post it.

### 1:16–1:35 — Revise the same Slides document

**Screen:** Show Slide 7. Focus the posted thread and choose **Ask agent**. In a compatible external agent, show the completed `get_review_context`, `read_document`, and `propose_revision` result without exposing internal traces. Return to DSTAR, open the linked pending version, review the changed slide, and click **Accept change**. Resolve the thread in a separate action.

**Agent instruction:**

> Address the focused comment by revising this slide. Preserve the visual design and stable element IDs. Submit a linked proposal, but do not accept it or resolve the comment.

**Narration:**

> Next, I ask the agent to address that feedback. It reads the accepted Slides document, then submits a linked revision. The current version doesn't change until the Owner reviews and accepts it. And resolving the discussion? That's a separate decision.

### 1:35–1:52 — Why WebMCP

**Screen:** End on Slide 8, then briefly show the Slides Viewer with Comments and Versions. Finish on the DSTAR library.

**Narration:**

> A normal MCP server can read stored files. WebMCP knows what is happening on the page right now: the active slide, the exact selection, the focused thread, and the user's intent. That's the missing bridge. Agents create. People review, collaborate, and decide.

## Recording rules

- Use the Slides document for both the explanation and the live comment/revision flow.
- Show only the compatible agent's prompt and completed result, not internal traces.
- Cut generation delays, but show the successful tool names or the final result long enough to verify the action.
- Keep private handoff URLs, credentials, tokens, local filesystem paths, and unrelated tabs off camera. Paste the handoff before the shot or crop the user prompt; show the agent result, not the credential-bearing input.
- Record at 1280×720 or 1920×1080. Use the same framing throughout.
- Keep narration conversational, with a pause between chapters. Use no background music unless it remains well below the voice.
- Start from a clean Slides workspace so the video shows exactly one comment, one linked proposal, one Owner acceptance, and one separately resolved thread.

## Verification checklist

- The first two slides make the origin and pain explicit before introducing the product.
- All four document formats appear once and remain visually distinct.
- Comment drafting returns an editable draft and never posts automatically.
- The proposed revision is linked to the focused comment and does not alter the current version before Owner acceptance.
- The external-agent frame shows only the interaction result; no trace, token, or local path is visible.
- The final export is below 1:55, has readable text at normal playback size, audible pauses, no black frames, and no copyrighted music.
