import { PreviewState } from "./preview-state.js";
import {
  RefreshGate,
  agentHandoffPrompt,
  addressCommentContext,
  reviewContext,
  selectionMessageFromEvent,
  selectionButtonPosition,
  commentThreads,
  annotationEventFromFrame,
} from "./review-state.js";
import { registerWebMCP } from "./webmcp.js";
import { AUTH_MESSAGE, ViewerSession } from "./session.js";
import { renderFileDiff } from "./diff-view.js";
import {
  actorCopy,
  changeSummary,
  technicalVersion,
  versionCopy,
  versionList,
} from "./viewer-model.js";

const $ = (id) => document.getElementById(id);
const previewState = new PreviewState();
const refreshGate = new RefreshGate();
let previewTimer;
const allowed = (capability) =>
  typeof session.can !== "function" || session.can(capability);
const canAccept = () =>
  session.authorized &&
  allowed("decide") &&
  previewState.canAccept(selected, current?.state.head, showingBase);
const session = new ViewerSession({
  fetch,
  storage: () => sessionStorage,
  onAuthorization: authorizationChanged,
});
session.restore(location, history);
const requestedHandoff = new document.defaultView.URLSearchParams(
    location.search,
  ).get("handoff"),
  incomingHandoffId = /^[a-f0-9-]{36}$/.test(requestedHandoff ?? "")
    ? requestedHandoff
    : null;
let current,
  selected,
  frame,
  target,
  selectionAction,
  commentTarget,
  commentTriggerTarget,
  suggestionTarget,
  suggestionKey,
  activeTab = "comments-panel",
  viewMode = "preview",
  diffFile = null,
  diffSerial = 0,
  diffController = null,
  activeGroup = null,
  activeCommentId = null,
  pendingCommentFocus = null,
  annotations = null,
  annotationSerial = 0,
  showingBase = false,
  postingComment = false,
  postingSuggestion = false,
  postingReply = false,
  replyDraft = null,
  suggestionDeletion = false,
  incomingHandoff = null,
  outgoingHandoff = null,
  outgoingDraftId = null,
  commentAgentStates = new Map(),
  messageTimer;
let previewSerial = 0;
function ask(title, detail, reply = false) {
  const dialog = $("confirmation");
  $("confirmation-title").textContent = title;
  $("confirmation-detail").textContent = detail;
  $("reply-text").hidden = !reply;
  $("reply-text").value = "";
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.onclose = () =>
      resolve(
        dialog.returnValue === "confirm"
          ? reply
            ? $("reply-text").value
            : "confirm"
          : null,
      );
  });
}
const note = (message) => {
  $("status").textContent = message;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    $("status").textContent = "";
  }, 7000);
};
function setAgentStatus(state, message = "") {
  const status = $("agent-status");
  status.dataset.agentState = state;
  status.textContent = message;
  status.hidden = !message;
}
const api = (path, body, signal) => session.request(path, body, signal);
const safely =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      note(error.message);
    }
  };
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function applySession() {
  $("copy-access-link").hidden = !session.can("share");
  $("copy-access-link").disabled = !session.can("share");
  $("selection-comment").hidden = !session.can("comment");
  $("selection-suggest").hidden = !session.can("suggest");
}
function resetTarget() {
  target = null;
  selectionAction = null;
  commentTarget = null;
  commentTriggerTarget = null;
  suggestionTarget = null;
  suggestionKey = null;
  suggestionDeletion = false;
  $("body").value = "";
  $("suggestion-body").value = "";
  $("selection-actions").hidden = true;
  $("comment-form").hidden = true;
  $("suggestion-form").hidden = true;
  $("selection").textContent = "";
  $("suggestion-selection").textContent = "";
  $("add-comment").disabled = true;
  $("add-suggestion").disabled = true;
  $("whole-element").hidden = true;
}
const sameTarget = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
const motivatingComments = (proposal) =>
  (proposal?.motivatedBy ?? []).map((id) => ({
    id,
    comment: current?.state.comments.find((entry) => entry.id === id),
  }));
function renderProposalAddresses(proposal, container, compact = false) {
  container.replaceChildren();
  for (const { id, comment } of motivatingComments(proposal)) {
    const item = el(
      compact ? "small" : "button",
      `Addresses comment ${id.slice(0, 8)}${comment ? `: ${comment.body.slice(0, compact ? 60 : 120)}` : ""}`,
      "proposal-address",
    );
    if (!compact && comment) {
      item.type = "button";
      item.onclick = () => focusComment(id);
    }
    container.append(item);
  }
}
const suggestionReady = () =>
  suggestionTarget?.selector.type === "text-range" &&
  (suggestionDeletion || $("suggestion-body").value.trim());
function setPanel(panel, open, focus = false) {
  activeTab = panel;
  $("review-sidebar").hidden = !open;
  for (const [id, tab] of [
    ["comments-panel", "tab-comments"],
    ["navigation", "tab-versions"],
  ]) {
    $(id).hidden = id !== panel;
    $(tab).setAttribute("aria-selected", String(id === panel));
    $(tab).setAttribute("aria-expanded", String(open && id === panel));
    $(tab).title =
      open && id === panel ? `Close ${$(tab).textContent.trim()}` : "";
    $(tab).tabIndex = id === panel ? 0 : -1;
  }
  $("selection-actions").hidden = true;
  if (focus)
    $(panel === "comments-panel" ? "tab-comments" : "tab-versions").focus();
  sendAnnotations();
}
for (const [panel, tab] of [
  ["comments-panel", "tab-comments"],
  ["navigation", "tab-versions"],
]) {
  $(tab).onclick = () =>
    setPanel(panel, $("review-sidebar").hidden || activeTab !== panel);
  $(tab).onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "comments-panel"
        : event.key === "End"
          ? "navigation"
          : panel === "comments-panel"
            ? "navigation"
            : "comments-panel";
    setPanel(next, true, true);
  };
}
setPanel(activeTab, document.documentElement.clientWidth > 1100);
function describeTarget(selectedTarget, output) {
  $(output).textContent =
    selectedTarget.selector.type === "element"
      ? "Whole element selected"
      : `“${(selectedTarget.selector.type === "text-ranges"
          ? selectedTarget.selector.ranges.map((part) => part.exact).join(" ")
          : selectedTarget.selector.exact
        ).slice(0, 240)}”`;
}
function composeComment(selectedTarget = target) {
  if (
    !selectedTarget ||
    !session.can("comment") ||
    previewState.status !== "ready"
  )
    return;
  setView("preview");
  setPanel("comments-panel", true);
  if (
    suggestionTarget &&
    ($("suggestion-body").value.trim() || suggestionDeletion)
  )
    return note("Submit or cancel your current suggestion first.");
  suggestionTarget = null;
  $("suggestion-form").hidden = true;
  if (commentTarget && $("body").value.trim()) {
    note("Post or cancel your current comment before starting another.");
  } else {
    commentTarget = selectedTarget;
    describeTarget(commentTarget, "selection");
  }
  $("whole-element").hidden = commentTarget.selector.type !== "text-range";
  $("comment-form").hidden = false;
  $("comments-empty").hidden = true;
  $("add-comment").disabled = postingComment || !$("body").value.trim();
  $("body").focus();
}
function composeSuggestion(selectedTarget = target) {
  if (
    !selectedTarget ||
    !session.can("suggest") ||
    previewState.status !== "ready"
  )
    return;
  setView("preview");
  setPanel("comments-panel", true);
  if (commentTarget && $("body").value.trim())
    return note("Post or cancel your current comment first.");
  commentTarget = null;
  $("comment-form").hidden = true;
  if (
    suggestionTarget &&
    ($("suggestion-body").value.trim() || suggestionDeletion)
  ) {
    note("Submit or cancel your current suggestion before starting another.");
  } else {
    suggestionTarget = selectedTarget;
    suggestionKey = document.defaultView.crypto.randomUUID();
    describeTarget(suggestionTarget, "suggestion-selection");
  }
  const manual = suggestionTarget.selector.type === "text-range";
  $("suggestion-form").hidden = false;
  $("suggestion-hint").hidden = manual;
  $("comments-empty").hidden = true;
  $("add-suggestion").disabled =
    postingSuggestion || !manual || !suggestionReady();
  $("delete-suggestion").disabled = postingSuggestion || !manual;
  $("suggestion-body").focus();
}
const preserveCommentSelection = (event) => {
  event.preventDefault();
  commentTriggerTarget = target;
};
// Clicking outside the sandboxed preview can collapse its text selection before
// click fires. Capture the target on pointerdown so mouse, pen and touch all keep
// the exact selection that the icon belongs to.
$("selection-comment").onpointerdown = preserveCommentSelection;
$("selection-comment").onmousedown = preserveCommentSelection;
$("selection-comment").onclick = () => {
  const selectedTarget = commentTriggerTarget || target;
  commentTriggerTarget = null;
  selectionAction = null;
  composeComment(selectedTarget);
};
$("selection-suggest").onpointerdown = preserveCommentSelection;
$("selection-suggest").onmousedown = preserveCommentSelection;
$("selection-suggest").onclick = () => {
  const selectedTarget = commentTriggerTarget || target;
  commentTriggerTarget = null;
  if (!selectedTarget) return;
  selectionAction = null;
  composeSuggestion(selectedTarget);
};
const newHandoffToken = () => {
  const bytes = new Uint8Array(32);
  document.defaultView.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
async function revokeOutgoingHandoff(nextState = "expired") {
  const handoff = outgoingHandoff;
  outgoingHandoff = null;
  outgoingDraftId = null;
  if (!handoff) return;
  if (handoff.context.action.kind === "address-comment") {
    commentAgentStates.set(handoff.context.action.commentId, nextState);
    if (current) comments();
  }
  setAgentStatus(
    nextState,
    nextState === "returned"
      ? "Agent result returned. Review it before posting or deciding."
      : "The agent handoff expired or was revoked because the review context changed.",
  );
  try {
    await api(`handoffs/${handoff.id}/revoke`, {});
  } catch {
    // Local state still fails closed; the server also expires and state-binds it.
  }
}
async function createAgentHandoff(kind, context) {
  if (context.action?.kind !== kind)
    throw new Error("The requested action is no longer ready for an agent");
  await revokeOutgoingHandoff();
  const id = document.defaultView.crypto.randomUUID(),
    accessToken = newHandoffToken(),
    handoffUrl = new URL(location.origin);
  handoffUrl.searchParams.set("handoff", id);
  handoffUrl.hash = accessToken;
  await api("handoffs", { id, accessToken, context });
  outgoingHandoff = {
    id,
    context,
    stateId: current.stateId,
    proposalIds: current.state.proposals.map((proposal) => proposal.id),
  };
  if (kind === "address-comment") {
    commentAgentStates.set(context.action.commentId, "waiting");
    comments();
  }
  setAgentStatus(
    "waiting",
    "Waiting for the agent. You can keep reading; the draft will return here.",
  );
  outgoingDraftId = null;
  const prompt = agentHandoffPrompt(
      kind,
      handoffUrl.href,
      context.selection?.selector.type,
    ),
    clipboard = document.defaultView.navigator.clipboard;
  try {
    if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
    await clipboard.writeText(prompt);
    note(
      "Private 15-minute agent handoff copied — paste it into your agent chat.",
    );
  } catch {
    await revokeOutgoingHandoff();
    throw new Error(
      "Agent handoff was revoked because copying failed. Try again.",
    );
  }
}
async function copyAgentHandoff(kind) {
  if (!session.can("handoff"))
    throw new Error("This role cannot create an agent handoff");
  const context = reviewContext(
    selected,
    showingBase,
    frame,
    previewState,
    target,
    selectionAction,
    activeCommentId,
  );
  await createAgentHandoff(kind, context);
}
$("ask-agent-comment").onclick = async () => {
  if (!commentTarget || postingComment) return;
  target = commentTarget;
  selectionAction = {
    kind: "comment",
    target: commentTarget,
    draft: $("body").value,
  };
  await copyAgentHandoff("comment");
};
$("ask-agent-suggestion").onclick = async () => {
  if (!suggestionTarget || postingSuggestion) return;
  target = suggestionTarget;
  selectionAction = {
    kind: "suggest",
    target: suggestionTarget,
    draft: $("suggestion-body").value,
  };
  await copyAgentHandoff("suggest");
};
$("cancel-comment").onclick = () => {
  $("body").value = "";
  resetTarget();
  $("comments-empty").hidden = !!current?.state.comments.length;
  $("tab-comments").focus();
};
$("cancel-suggestion").onclick = () => {
  resetTarget();
  $("comments-empty").hidden = !!current?.state.comments.length;
  $("tab-comments").focus();
};
$("body").oninput = () => {
  $("add-comment").disabled =
    postingComment || !commentTarget || !$("body").value.trim();
};
$("suggestion-body").oninput = () => {
  suggestionDeletion = false;
  $("add-suggestion").disabled = postingSuggestion || !suggestionReady();
};
$("delete-suggestion").onclick = () => {
  if (postingSuggestion || suggestionTarget?.selector.type !== "text-range")
    return;
  $("suggestion-body").value = "";
  suggestionDeletion = true;
  $("add-suggestion").disabled = false;
  note("Deletion suggestion ready — submit it to Versions.");
};
addEventListener("resize", () => {
  $("selection-actions").hidden = true;
});
addEventListener(
  "scroll",
  () => {
    $("selection-actions").hidden = true;
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if ($("confirmation").open) return;
    $("selection-actions").hidden = true;
    $("viewer-menu").open = false;
    if (!$("review-sidebar").hidden) setPanel(activeTab, false, true);
  }
});
document.addEventListener("click", (event) => {
  if (!$("viewer-menu").contains(event.target)) $("viewer-menu").open = false;
});
async function preview(id) {
  const serial = ++previewSerial;
  clearTimeout(previewTimer);
  previewState.reset();
  annotations = null;
  activeGroup = null;
  ++annotationSerial;
  $("accept").disabled = true;
  resetTarget();
  if (current) comments();
  $("previous-slide").hidden = true;
  $("next-slide").hidden = true;
  frame = null;
  $("preview").hidden = !id;
  $("empty").hidden = !!id;
  if (!id) {
    $("preview").removeAttribute("src");
    return;
  }
  let loaded;
  try {
    loaded = await api(`preview/${id}`);
  } catch (error) {
    if (serial === previewSerial) previewState.fail();
    throw error;
  }
  if (serial !== previewSerial) return;
  frame = loaded;
  previewState.reset(frame);
  previewTimer = setTimeout(() => {
    if (serial !== previewSerial) return;
    previewState.fail();
    $("accept").disabled = true;
    note("The document did not finish loading. Refresh before accepting.");
  }, 20000);
  // iframe load also fires for HTTP error pages; it is never approval evidence.
  $("preview").src = frame.url;
}
async function select(id, { keepPreview = false } = {}) {
  const previous = selected?.id;
  if (outgoingHandoff && previous !== id) await revokeOutgoingHandoff();
  selected = current.state.proposals.find((p) => p.id === id);
  if (!keepPreview) showingBase = false;
  const copy = versionCopy(selected, current.state, showingBase),
    reviewing = copy.kind === "suggested",
    canDecide = allowed("decide");
  document.body.dataset.viewerMode = reviewing ? "review" : "read";
  $("document-status").textContent = copy.badge;
  $("document-status").dataset.status = copy.kind;
  $("document-status").hidden = false;
  $("review-summary").hidden = !reviewing;
  $("decision-bar").hidden = !reviewing;
  $("decision-bar").dataset.permission = canDecide ? "decide" : "review";
  $("decision-title").textContent = canDecide
    ? "Ready to decide?"
    : "Review this suggestion";
  $("decision-bar").querySelector(".decision-actions").hidden = !canDecide;
  $("exit-review").hidden = !reviewing || !current.state.head;
  $("before-after").hidden = !reviewing || !selected?.parent;
  $("show-before").setAttribute("aria-pressed", String(showingBase));
  $("show-after").setAttribute("aria-pressed", String(!showingBase));
  $("version-detail").hidden = !selected;
  $("accept").disabled = !canAccept();
  $("stale").hidden =
    selected?.status !== "pending" || selected.parent === current.state.head;
  if (selected) {
    const actor = actorCopy(selected.author);
    $("version-revision").textContent = technicalVersion(selected);
    $("review-heading").textContent = selected.request;
    $("review-author").textContent = actor.name;
    $("review-change-summary").textContent = changeSummary(selected);
    $("review-next-step").textContent = copy.nextStep;
    $("decision-hint").textContent = !canDecide
      ? "You can comment and suggest changes. Only the Owner can accept or reject."
      : viewMode === "changes"
        ? "The exact suggested document is ready; you can decide here or return to the document."
        : "Review the After version and its changes before deciding.";
    renderProposalAddresses(selected, $("version-addresses"));
    const bytes = selected.changes.reduce(
        (sum, c) => sum + (c.storage?.size ?? 0),
        0,
      ),
      deltas = selected.changes.filter(
        (c) => c.storage?.encoding === "gzip-delta-v1",
      ).length;
    $("storage").textContent =
      `${selected.changes.length} changed files · ${bytes.toLocaleString()} compressed bytes · ${deltas} deltas · ${selected.diff.anchorRisks.length} comment anchor warnings`;
  } else $("version-addresses").replaceChildren();
  if (previous !== selected?.id) {
    diffFile = null;
    ++diffSerial;
    diffController?.abort();
    $("diff").replaceChildren();
  }
  if (!selected) setView("preview");
  else {
    diffOverview();
    if (viewMode === "changes" && previous !== selected.id)
      loadDiffFile(selected.diff.files[0]?.path);
  }
  document
    .querySelectorAll("[data-proposal]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.proposal === id),
    );
  if (!keepPreview) await preview(id);
}
function setView(mode) {
  if (mode === "changes" && !selected) return;
  viewMode = mode;
  $("preview-panel").hidden = mode !== "preview";
  $("diff-panel").hidden = mode !== "changes";
  $("preview-controls").hidden = mode !== "preview";
  $("selection-actions").hidden = true;
  $("accept").disabled = !canAccept();
  if (selected?.status === "pending")
    $("decision-hint").textContent = !allowed("decide")
      ? "You can comment and suggest changes. Only the Owner can accept or reject."
      : mode === "changes"
        ? "The exact suggested document is ready; you can decide here or return to the document."
        : "Review the After version and its changes before deciding.";
  if (mode === "changes") {
    diffOverview();
    if (!diffFile) loadDiffFile(selected.diff.files[0]?.path);
  }
}
$("inspect-changes").onclick = () => {
  setView("changes");
  if (document.documentElement.clientWidth <= 760) setPanel(activeTab, false);
};
$("close-changes").onclick = () => setView("preview");
function diffOverview() {
  if (!selected) return;
  $("diff-title").textContent = selected.request;
  $("diff-versions").textContent =
    selected.status === "pending"
      ? "Before → After"
      : "Changes introduced in this version";
  $("diff-revisions").textContent = technicalVersion(selected);
  $("diff-stats").replaceChildren();
  for (const [kind, label] of [
    ["added", "added"],
    ["modified", "modified"],
    ["removed", "removed"],
  ]) {
    const count = selected.diff.files.filter(
      (file) => file.kind === kind,
    ).length;
    if (count)
      $("diff-stats").append(
        el(
          "span",
          `${count} ${label} ${count === 1 ? "file" : "files"}`,
          `diff-stat ${kind}`,
        ),
      );
  }
  $("diff-stats").append(
    el(
      "span",
      `${selected.diff.elementChangeCount} changed ${selected.diff.elementChangeCount === 1 ? "element" : "elements"}`,
      "diff-stat",
    ),
  );
  $("diff-warnings").replaceChildren();
  if (selected.diff.anchorRisks.length)
    $("diff-warnings").append(
      el(
        "p",
        `${selected.diff.anchorRisks.length} comment locations may be affected. Check Comments before accepting.`,
      ),
    );
  if (selected.diff.rewriteRatio > 0)
    $("diff-warnings").append(
      el(
        "p",
        `${Math.round(selected.diff.rewriteRatio * 100)}% of previous element IDs were removed.`,
      ),
    );
  $("diff-warnings").hidden = !$("diff-warnings").children.length;
  $("diff-files").replaceChildren();
  for (const file of selected.diff.files) {
    const button = el("button");
    button.append(
      el(
        "span",
        { added: "+", removed: "−", modified: "~" }[file.kind],
        `file-kind ${file.kind}`,
      ),
      el("span", file.path),
    );
    button.setAttribute("aria-pressed", String(file.path === diffFile));
    button.dataset.diffFile = file.path;
    button.onclick = () => loadDiffFile(file.path);
    $("diff-files").append(button);
  }
}
async function loadDiffFile(path) {
  const proposal = selected;
  diffController?.abort();
  const serial = ++diffSerial;
  diffFile = path ?? null;
  diffOverview();
  if (!path) {
    $("diff").replaceChildren(
      el("p", "No file changes in this version.", "diff-notice"),
    );
    return;
  }
  diffController = new AbortController();
  $("diff").replaceChildren(el("p", "Loading changes…", "diff-notice"));
  try {
    const data = await api(
      `diff/${proposal.id}?file=${encodeURIComponent(path)}`,
      undefined,
      diffController.signal,
    );
    if (serial !== diffSerial || selected?.id !== proposal.id) return;
    if (
      data.proposalId !== proposal.id ||
      data.revision !== proposal.revision ||
      data.base !== proposal.base ||
      data.path !== path
    )
      throw new Error("The diff does not match the selected version.");
    renderFileDiff($("diff"), data);
  } catch (error) {
    if (serial !== diffSerial || selected?.id !== proposal.id) return;
    $("diff").replaceChildren(
      el("p", `Could not load changes. ${error.message}`, "diff-notice"),
    );
    const retry = el("button", "Retry");
    retry.onclick = () => loadDiffFile(path);
    $("diff").append(retry);
  }
}
function located(comment) {
  return ["exact", "recovered"].includes(
    annotations?.anchors[comment.id]?.status,
  );
}
function sendAnnotations(focus = null) {
  if (
    !current ||
    !frame ||
    previewState.status !== "ready" ||
    annotations?.revision !== frame.revision
  )
    return;
  const groups = commentThreads(current.state.comments)
    .map((thread) => ({
      id: thread.id,
      element: thread.element,
      number: thread.number,
      resolved: thread.comment.status !== "open",
      anchors: located(thread.comment)
        ? [
            {
              type: thread.comment.target.selector.type,
              ...annotations.anchors[thread.id],
            },
          ]
        : [],
    }))
    .filter((group) => group.anchors.length);
  $("preview").contentWindow.postMessage(
    {
      kind: "dstar-annotations",
      capability: frame.capability,
      revision: frame.revision,
      groups,
      active: activeGroup,
      focus,
    },
    "*",
  );
}
async function syncAnnotations() {
  if (!frame || !selected || previewState.status !== "ready") return;
  const expected = frame,
    serial = ++annotationSerial;
  try {
    const result = await api(
      `annotations/${showingBase ? selected.parent : selected.id}`,
    );
    if (
      serial !== annotationSerial ||
      frame !== expected ||
      result.revision !== frame.revision ||
      result.stateId !== current?.stateId
    )
      return;
    annotations = result;
    const pending = current?.state.comments.find(
      (comment) => comment.id === pendingCommentFocus,
    );
    const focus = pending && located(pending) ? pending.id : null;
    pendingCommentFocus = null;
    comments();
    sendAnnotations(focus);
    if (pending)
      note(
        focus
          ? "Thread selected in the document."
          : "This thread cannot be located in this version.",
      );
  } catch (error) {
    if (serial !== annotationSerial || frame !== expected) return;
    annotations = null;
    pendingCommentFocus = null;
    $("preview").contentWindow.postMessage(
      {
        kind: "dstar-annotations",
        capability: frame.capability,
        revision: frame.revision,
        groups: [],
        active: null,
      },
      "*",
    );
    comments();
    note(`Comment locations unavailable. ${error.message}`);
  }
}
function focusGroup(id, fromList = true) {
  const comment = current?.state.comments.find((entry) => entry.id === id);
  if (!comment || !located(comment)) return;
  setView("preview");
  activeGroup = id;
  if (activeCommentId !== id) {
    if (
      outgoingHandoff?.context.action.kind === "address-comment" &&
      outgoingHandoff.context.action.commentId !== id
    )
      safely(revokeOutgoingHandoff)();
    activeCommentId = id;
  }
  setPanel("comments-panel", true);
  updateReviewFocus();
  const thread = document.querySelector(
    `.comment[data-comment="${activeCommentId}"]`,
  );
  if (thread && !fromList) {
    const resolved = thread.closest("details");
    if (resolved) resolved.open = true;
    thread.scrollIntoView({ block: "nearest" });
    thread.focus({ preventScroll: true });
  }
  sendAnnotations(fromList ? id : null);
}
function updateReviewFocus() {
  document.querySelectorAll(".comment-thread").forEach((thread) => {
    const active = thread.dataset.thread === activeCommentId;
    thread.classList.toggle("active", active);
    if (active) thread.open = true;
  });
  document.querySelectorAll(".comment[data-comment]").forEach((article) => {
    const active = article.dataset.comment === activeCommentId;
    article.classList.toggle("active", active);
    article.setAttribute("aria-current", String(active));
  });
}
function focusComment(id, announce = true) {
  const comment = current?.state.comments.find((entry) => entry.id === id);
  if (!comment) return;
  setView("preview");
  if (
    outgoingHandoff?.context.action.kind === "address-comment" &&
    outgoingHandoff.context.action.commentId !== id
  )
    safely(revokeOutgoingHandoff)();
  activeCommentId = id;
  activeGroup = comment.id;
  setPanel("comments-panel", true);
  updateReviewFocus();
  sendAnnotations(announce && located(comment) ? activeGroup : null);
  if (announce) {
    if (document.documentElement.clientWidth <= 760) setPanel(activeTab, false);
    note(
      located(comment)
        ? "Thread selected in the document."
        : "This thread cannot be located in the open version.",
    );
  }
}
async function openCommentInDocument(id) {
  const comment = current?.state.comments.find((entry) => entry.id === id);
  if (!comment) return;
  const commentedVersion = current.state.proposals.find(
    (proposal) => proposal.revision === comment.target.revision,
  );
  pendingCommentFocus = id;
  if (commentedVersion && selected?.revision !== comment.target.revision)
    await select(commentedVersion.id);
  focusComment(id, false);
  const ready =
    previewState.status === "ready" &&
    annotations?.revision === frame?.revision;
  if (ready && located(comment)) {
    pendingCommentFocus = null;
    sendAnnotations(comment.id);
  }
  if (ready && !located(comment)) pendingCommentFocus = null;
  if (document.documentElement.clientWidth <= 760) setPanel(activeTab, false);
  note(
    !ready
      ? "Opening thread in the document…"
      : located(comment)
        ? "Thread selected in the document."
        : "This thread cannot be located in this version.",
  );
}
function openReplyDraft(comment, body = "") {
  if (replyDraft?.commentId === comment.id) {
    focusComment(comment.id, false);
    comments();
    return true;
  }
  if (replyDraft) {
    note("Post or cancel your current reply draft first.");
    return false;
  }
  replyDraft = {
    commentId: comment.id,
    body,
    expectedStateId: current.stateId,
  };
  focusComment(comment.id, false);
  comments();
  document
    .querySelector(`.reply-composer[data-comment="${comment.id}"] textarea`)
    ?.focus();
  return true;
}
function replyComposer(comment) {
  const form = el("form", undefined, "reply-composer");
  form.dataset.comment = comment.id;
  const input = el("textarea", undefined, "reply-draft");
  input.value = replyDraft.body;
  input.maxLength = 20000;
  input.placeholder = "Edit the reply before posting…";
  input.setAttribute("aria-label", `Reply to comment ${comment.id}`);
  const stale = replyDraft.expectedStateId !== current.stateId;
  input.disabled = postingReply || stale;
  input.oninput = () => {
    if (replyDraft?.commentId === comment.id) replyDraft.body = input.value;
    submit.disabled = postingReply || stale || !input.value.trim();
  };
  const actions = el("div", undefined, "composer-actions"),
    cancel = el("button", "Cancel"),
    submit = el("button", postingReply ? "Posting…" : "Post reply", "primary");
  cancel.type = "button";
  cancel.disabled = postingReply;
  cancel.onclick = () => {
    commentAgentStates.set(comment.id, "idle");
    replyDraft = null;
    comments();
  };
  submit.disabled = postingReply || stale || !input.value.trim();
  form.onsubmit = safely(async (event) => {
    event.preventDefault();
    if (
      postingReply ||
      stale ||
      replyDraft?.commentId !== comment.id ||
      !replyDraft.body.trim()
    )
      return;
    postingReply = true;
    comments();
    try {
      await api(`comments/${comment.id}/reply`, {
        body: replyDraft.body,
        stateId: replyDraft.expectedStateId,
      });
      commentAgentStates.set(comment.id, "idle");
      replyDraft = null;
      await refresh();
      focusComment(comment.id, false);
      note("Reply posted");
    } finally {
      postingReply = false;
      if (replyDraft) comments();
    }
  });
  actions.append(cancel, submit);
  form.append(input);
  if (stale)
    form.append(
      el(
        "p",
        "The review state changed. Cancel this draft and start again.",
        "draft-conflict",
      ),
    );
  form.append(actions);
  return form;
}
function commentThread(thread, expanded = false) {
  const c = thread.comment,
    card = el("details", undefined, "comment-thread"),
    article = el("article", undefined, "comment"),
    commentActor = actorCopy(c.author);
  card.dataset.thread = c.id;
  card.open = expanded;
  card.classList.toggle("active", c.id === activeCommentId);
  const summary = el("summary", undefined, "thread-summary"),
    summaryCopy = el("span", undefined, "thread-summary-copy"),
    preview = c.body.replace(/\s+/g, " ").trim();
  summaryCopy.append(
    el("strong", commentActor.name),
    el("small", preview.length > 80 ? `${preview.slice(0, 80)}…` : preview),
  );
  summary.append(
    el("span", thread.number, "thread-number"),
    summaryCopy,
    el(
      "span",
      c.status === "open" ? "Open" : "Resolved",
      `thread-status ${c.status}`,
    ),
    el("span", "⌄", "thread-chevron"),
  );
  summary.setAttribute(
    "aria-label",
    `Thread ${thread.number}, ${c.status}, by ${commentActor.name}: ${preview.slice(0, 160)}`,
  );
  summary.onclick = (event) => {
    event.preventDefault();
    card.open = !card.open;
    if (card.open) safely(() => openCommentInDocument(c.id))();
  };
  article.dataset.comment = c.id;
  article.tabIndex = 0;
  article.classList.toggle("active", c.id === activeCommentId);
  article.setAttribute("aria-current", String(c.id === activeCommentId));
  article.setAttribute(
    "aria-label",
    `${c.status === "open" ? "Open" : "Resolved"} thread by ${commentActor.name}: ${c.body.slice(0, 160)}`,
  );
  const agentState = commentAgentStates.get(c.id) ?? "idle";
  article.dataset.agentState = agentState;
  article.onclick = (event) => {
    if (
      !event.target.closest(
        "button, a, textarea, input, form, details, summary",
      )
    )
      safely(() => openCommentInDocument(c.id))();
  };
  article.onkeydown = (event) => {
    if (event.target !== article || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    safely(() => openCommentInDocument(c.id))();
  };
  const author = el("div", undefined, "comment-author");
  author.append(
    el("span", commentActor.name.slice(0, 1).toUpperCase(), "avatar"),
    el("strong", commentActor.name),
  );
  if (commentActor.role)
    author.append(el("span", commentActor.role, "role-badge"));
  article.append(author);
  article.append(el("p", c.body));
  for (const r of c.replies) {
    const reply = el("div", undefined, "reply"),
      replyActor = actorCopy(r.author),
      replyBy = el("small", replyActor.name);
    if (replyActor.role) replyBy.append(` · ${replyActor.role}`);
    reply.append(replyBy, el("p", r.body));
    article.append(reply);
  }
  const linked = current.state.proposals.filter((proposal) =>
    (proposal.motivatedBy ?? []).includes(c.id),
  );
  if (linked.length) {
    const links = el("div", undefined, "linked-proposals");
    for (const proposal of linked) {
      const link = el(
        "button",
        `Addressed by proposal ${proposal.id.slice(0, 8)} · ${proposal.status}`,
      );
      link.type = "button";
      link.onclick = safely(async () => {
        await select(proposal.id);
        setPanel("navigation", true);
      });
      links.append(link);
    }
    article.append(links);
  }
  if (replyDraft?.commentId === c.id) article.append(replyComposer(c));
  const actions = el("div", undefined, "comment-actions");
  if (session.can("reply")) {
    const reply = el("button", "Reply");
    reply.type = "button";
    reply.onclick = () => openReplyDraft(c);
    actions.append(reply);
  }
  if (
    c.status === "open" &&
    ["handoff", "read", "reply", "propose"].every((capability) =>
      session.can(capability),
    )
  ) {
    const address = el("button", "Ask agent", "comment-address-agent");
    address.type = "button";
    address.title = "Ask the agent to draft a reply or suggest a change";
    address.onclick = safely(async () => {
      if (replyDraft?.body)
        return note("Post or cancel your current reply draft first.");
      focusComment(c.id, false);
      const context = addressCommentContext(
        selected,
        showingBase,
        frame,
        previewState,
        c,
      );
      await createAgentHandoff("address-comment", context);
    });
    actions.append(address);
  }
  if (c.status === "open" && session.can("resolve")) {
    const resolve = el("button", "Resolve");
    resolve.onclick = safely(async () => {
      await api(`comments/${c.id}/resolve`, { stateId: current.stateId });
      await refresh();
    });
    actions.append(resolve);
  }
  const commentedVersion = current.state.proposals.find(
    (proposal) => proposal.revision === c.target.revision,
  );
  article.append(actions);
  if (annotations && !located(c))
    article.append(
      el(
        "small",
        commentedVersion
          ? "This comment belongs to another version."
          : "This comment cannot be located in this version.",
        "anchor-warning",
      ),
    );
  card.append(summary, article);
  return card;
}
function comments() {
  const list = current.state.comments,
    threads = commentThreads(list),
    open = list.filter((c) => c.status === "open").length;
  $("count").textContent = open;
  $("count").hidden = !open;
  $("comments-empty").hidden =
    !!list.length || !$("comment-form").hidden || !$("suggestion-form").hidden;
  $("comments-summary").textContent = list.length
    ? `${open} open · ${list.length} ${list.length === 1 ? "thread" : "threads"}`
    : "Each comment starts a thread.";
  const expanded = new Set(
    [...$("comments").querySelectorAll(".comment-thread[open]")].map(
      (thread) => thread.dataset.thread,
    ),
  );
  $("comments").replaceChildren();
  $("comments").append(
    ...threads.map((thread) =>
      commentThread(
        thread,
        expanded.has(thread.id) || thread.id === activeCommentId,
      ),
    ),
  );
}
function renderIdentity(publicSession) {
  const identity = publicSession?.identity;
  if (!identity) {
    $("viewer-identity").hidden = true;
    return;
  }
  const actor = actorCopy(identity);
  $("viewer-identity").replaceChildren(el("span", actor.name));
  if (actor.role && actor.role.toLowerCase() !== actor.name.toLowerCase())
    $("viewer-identity").append(el("span", actor.role, "role-badge"));
  $("viewer-identity").hidden = false;
}
function renderWorkspaceManagement(url) {
  const link = $("manage-workspace");
  link.hidden = !url;
  if (url) link.href = url;
  else link.removeAttribute("href");
}
function versionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}
function versionButton(proposal) {
  const button = el("button"),
    actor = actorCopy(proposal.author),
    copy = versionCopy(proposal, current.state);
  button.dataset.proposal = proposal.id;
  button.dataset.versionKind = copy.kind;
  const heading = el("span", undefined, "version-item-heading");
  heading.append(
    el("strong", proposal.request),
    el("span", copy.badge, `version-badge ${copy.kind}`),
  );
  button.append(
    heading,
    el(
      "small",
      `${actor.name} · ${versionTime(proposal.createdAt)} · ${changeSummary(proposal)}`,
    ),
  );
  if (proposal.motivatedBy?.length) {
    const addresses = el("span", undefined, "proposal-addresses");
    renderProposalAddresses(proposal, addresses, true);
    button.append(addresses);
  }
  button.onclick = safely(async () => {
    await select(proposal.id);
    if (document.documentElement.clientWidth <= 760)
      setPanel("navigation", false);
  });
  return button;
}
async function refresh({ retryPreview = false } = {}) {
  const serial = refreshGate.begin();
  const next = await api("state");
  if (!refreshGate.accept(serial, next.state.generation)) return;
  if (current?.stateId === next.stateId) {
    if (retryPreview && previewState.status === "failed")
      await preview(showingBase ? selected?.parent : selected?.id);
    else if (retryPreview && !annotations && previewState.status === "ready")
      await syncAnnotations();
    return;
  }
  const previousId = selected?.id;
  current = next;
  applySession();
  $("title").textContent = current.title;
  renderIdentity(current.session);
  renderWorkspaceManagement(current.workspaceManagementUrl);
  $("revision").textContent = current.revision
    ? `HEAD ${current.revision.slice(7, 23)}`
    : "No accepted revision yet";
  const pending = current.state.proposals.filter(
    (p) => p.status === "pending",
  ).length;
  $("proposal-count").textContent = pending;
  $("proposal-count").hidden = !pending;
  $("tab-versions").title =
    `${pending} suggested ${pending === 1 ? "change" : "changes"} to review`;
  const versions = versionList(current.state);
  $("versions").replaceChildren(...versions.map(versionButton));
  if (!versions.length)
    $("versions").append(el("p", "No versions yet.", "hint"));
  comments();
  const id = current.state.proposals.some((item) => item.id === previousId)
    ? previousId
    : (current.state.head ??
      versions.find((item) => item.status === "pending")?.id);
  await select(id, { keepPreview: !!previousId && previousId === id });
  if (previewState.status === "ready") await syncAnnotations();
  if (retryPreview && previewState.status === "failed")
    await preview(showingBase ? selected?.parent : selected?.id);
}
$("refresh").onclick = safely(() => refresh({ retryPreview: true }));
$("width").onchange = () => {
  $("selection-actions").hidden = true;
  $("preview").style.width = $("width").value;
};
async function showComparison(before) {
  if (!selected || selected.status !== "pending") return;
  await revokeOutgoingHandoff();
  showingBase = before && !!selected.parent;
  $("show-before").setAttribute("aria-pressed", String(showingBase));
  $("show-after").setAttribute("aria-pressed", String(!showingBase));
  $("accept").disabled = !canAccept();
  await preview(showingBase ? selected.parent : selected.id);
}
$("show-before").onclick = safely(() => showComparison(true));
$("show-after").onclick = safely(() => showComparison(false));
$("exit-review").onclick = safely(async () => {
  if (!current?.state.head) return;
  setView("preview");
  await select(current.state.head);
});
for (const action of ["accept", "reject"])
  $(action).onclick = safely(async () => {
    if (!allowed("decide")) return;
    if (action === "accept" && !canAccept()) return;
    const proposal = selected,
      stateId = current.stateId,
      serial = previewSerial;
    if (
      !(await ask(
        `${action === "accept" ? "Accept" : "Reject"} this suggestion?`,
        "This decision applies only to the exact change you reviewed. It will not include newer or unrelated work.",
      ))
    )
      return;
    if (action === "accept" && (serial !== previewSerial || !canAccept()))
      return;
    await api(`proposals/${proposal.id}/${action}`, {
      revision: proposal.revision,
      stateId,
    });
    note(action === "accept" ? "Change accepted" : "Suggestion rejected");
    await refresh();
  });
for (const [button, direction] of [
  ["previous-slide", -1],
  ["next-slide", 1],
])
  $(button).onclick = safely(async () => {
    await revokeOutgoingHandoff();
    if (frame)
      $("preview").contentWindow.postMessage(
        { kind: "dstar-slide", direction, capability: frame.capability },
        "*",
      );
  });
addEventListener("message", (event) => {
  if (previewState.receive(event, $("preview").contentWindow)) {
    clearTimeout(previewTimer);
    $("accept").disabled = !canAccept();
    const slides =
      previewState.status === "ready" && event.data.slides === true;
    $("previous-slide").hidden = !slides;
    $("next-slide").hidden = !slides;
    if (previewState.status === "ready") safely(syncAnnotations)();
    if (previewState.status === "failed")
      note("Document resources failed to load. Refresh before accepting.");
    return;
  }
  const annotation = annotationEventFromFrame(
    event,
    $("preview").contentWindow,
    frame,
    previewState,
  );
  if (annotation) {
    if (annotation.kind === "dstar-annotation-focus")
      focusGroup(annotation.group, false);
    return;
  }
  const selection = selectionMessageFromEvent(
    event,
    $("preview").contentWindow,
    frame,
    previewState,
  );
  if (!selection || viewMode !== "preview") return;
  target = selection.target;
  selectionAction = null;
  $("selection-actions").hidden = true;
  if (!target) return;
  if (selection.compose) return composeComment();
  const position = selectionButtonPosition(
    selection.rect,
    $("preview").getBoundingClientRect(),
    {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    { width: 82, height: 38 },
  );
  if (position) {
    $("selection-actions").style.left = `${position.left}px`;
    $("selection-actions").style.top = `${position.top}px`;
    $("selection-actions").hidden = false;
  }
});
$("whole-element").onclick = () => {
  if (commentTarget && !postingComment) {
    commentTarget = { ...commentTarget, selector: { type: "element" } };
    describeTarget(commentTarget, "selection");
  }
};
$("comment-form").onsubmit = safely(async (event) => {
  event.preventDefault();
  if (!commentTarget || postingComment || !$("body").value.trim()) return;
  const body = $("body").value,
    submittedTarget = commentTarget;
  postingComment = true;
  $("add-comment").disabled = true;
  $("cancel-comment").disabled = true;
  $("add-comment").textContent = "Posting…";
  try {
    const created = await api("comments", { target: submittedTarget, body });
    if (commentTarget === submittedTarget && $("body").value === body) {
      $("body").value = "";
      resetTarget();
    }
    note("Comment added");
    await refresh();
    focusGroup(created.id, false);
  } finally {
    postingComment = false;
    $("add-comment").textContent = "Post comment";
    $("cancel-comment").disabled = false;
    $("add-comment").disabled = !commentTarget || !$("body").value.trim();
  }
});
$("suggestion-form").onsubmit = safely(async (event) => {
  event.preventDefault();
  if (
    !suggestionTarget ||
    suggestionTarget.selector.type !== "text-range" ||
    postingSuggestion ||
    !suggestionReady()
  )
    return;
  const replacement = $("suggestion-body").value,
    submittedTarget = suggestionTarget,
    key = suggestionKey;
  postingSuggestion = true;
  $("add-suggestion").disabled = true;
  $("cancel-suggestion").disabled = true;
  $("add-suggestion").textContent = "Submitting…";
  try {
    const result = await api("suggestions", {
      target: submittedTarget,
      replacement,
      key,
    });
    if (
      suggestionTarget === submittedTarget &&
      $("suggestion-body").value === replacement
    ) {
      $("suggestion-body").value = "";
      resetTarget();
    }
    await refresh();
    await select(result.proposal.id);
    note("Suggestion added to Versions");
  } finally {
    postingSuggestion = false;
    $("add-suggestion").textContent = "Submit suggestion";
    $("cancel-suggestion").disabled = false;
    $("add-suggestion").disabled = !suggestionTarget || !suggestionReady();
  }
});
function applyCommentDraft({ target: draftedTarget, body, expectedDraft }) {
  if ($("body").value !== expectedDraft) return false;
  target = draftedTarget;
  selectionAction = null;
  composeComment(draftedTarget);
  $("body").value = body;
  $("add-comment").disabled = false;
  $("body").focus();
  setAgentStatus(
    "returned",
    "Agent draft returned. Review and edit it before posting.",
  );
  note("Agent comment draft is ready for review.");
  return true;
}
function applySuggestionDraft({
  target: draftedTarget,
  replacement,
  expectedDraft,
}) {
  if ($("suggestion-body").value !== expectedDraft) return false;
  target = draftedTarget;
  selectionAction = null;
  composeSuggestion(draftedTarget);
  $("suggestion-body").value = replacement;
  suggestionDeletion = replacement === "";
  $("add-suggestion").disabled =
    draftedTarget.selector.type !== "text-range" || !suggestionReady();
  $("suggestion-body").focus();
  setAgentStatus(
    "returned",
    "Agent draft returned. Review and edit it before submitting.",
  );
  note("Agent suggestion draft is ready for review.");
  return true;
}
async function sendIncomingHandoffDraft(kind, content) {
  if (incomingHandoff?.context.action?.kind !== kind) return false;
  await api(`handoffs/${incomingHandoffId}/draft`, { kind, content });
  note("Agent draft sent back to the original Viewer.");
  return true;
}
async function sendIncomingReplyDraft({ commentId, body }) {
  if (
    incomingHandoff?.context.action?.kind !== "address-comment" ||
    incomingHandoff.context.action.commentId !== commentId
  )
    return false;
  await api(`handoffs/${incomingHandoffId}/reply-draft`, { commentId, body });
  note("Editable reply draft sent back to the original Viewer.");
  return true;
}
function applyReplyDraft({ commentId, body, expectedStateId }) {
  const comment = current?.state.comments.find(
    (entry) => entry.id === commentId,
  );
  if (
    replyDraft ||
    current?.stateId !== expectedStateId ||
    activeCommentId !== commentId ||
    !comment ||
    comment.status !== "open"
  )
    return false;
  const applied = openReplyDraft(comment, body);
  if (applied) {
    commentAgentStates.set(commentId, "returned");
    comments();
  }
  return applied;
}
async function loadIncomingHandoff() {
  if (!incomingHandoffId || incomingHandoff) return;
  incomingHandoff = await api(`handoffs/${incomingHandoffId}`);
  setAgentStatus(
    "waiting",
    "Agent handoff is open. Return a draft before this access expires.",
  );
  note("Agent handoff loaded · read and draft access expires in 15 minutes.");
}
async function syncOutgoingHandoff() {
  if (!outgoingHandoff) return;
  if (current?.stateId !== outgoingHandoff.stateId) {
    const commentId = outgoingHandoff.context.action.commentId,
      linked = current?.state.proposals.find(
        (proposal) =>
          proposal.status === "pending" &&
          !outgoingHandoff.proposalIds.includes(proposal.id) &&
          (proposal.motivatedBy ?? []).includes(commentId),
      );
    if (commentId)
      commentAgentStates.set(commentId, linked ? "returned" : "expired");
    setAgentStatus(
      linked ? "returned" : "expired",
      linked
        ? "A linked proposal returned. Review it before deciding."
        : "The agent handoff expired because the review state changed.",
    );
    if (current) comments();
    outgoingHandoff = null;
    outgoingDraftId = null;
    note(
      linked
        ? `Linked proposal ready for review: ${linked.request}`
        : "Agent handoff closed because the review state changed.",
    );
    return;
  }
  let record;
  try {
    record = await api(`handoffs/${outgoingHandoff.id}`);
  } catch {
    if (outgoingHandoff?.context.action.kind === "address-comment")
      commentAgentStates.set(
        outgoingHandoff.context.action.commentId,
        "expired",
      );
    if (current) comments();
    outgoingHandoff = null;
    setAgentStatus(
      "expired",
      "The agent handoff expired. Ask the agent again to start a new one.",
    );
    note("Agent handoff expired. Use Ask agent again if needed.");
    return;
  }
  const returned = record.replyDraft ?? record.draft;
  if (!returned || returned.id === outgoingDraftId) return;
  outgoingDraftId = returned.id;
  const { action, selection } = outgoingHandoff.context;
  if (action.kind === "address-comment") {
    const review = outgoingHandoff.context.review;
    const sameView =
      !review ||
      (selected?.id === review.proposalId &&
        showingBase === review.showingBase &&
        frame?.revision === review.revision &&
        previewState.status === "ready");
    const applied =
      sameView &&
      record.replyDraft?.commentId === action.commentId &&
      applyReplyDraft({
        commentId: action.commentId,
        body: record.replyDraft.body,
        expectedStateId: outgoingHandoff.stateId,
      });
    if (!applied)
      note(
        "Agent returned a reply draft, but the focused comment, page or local draft changed; it was preserved.",
      );
    if (!applied) commentAgentStates.set(action.commentId, "expired");
    setAgentStatus(
      applied ? "returned" : "expired",
      applied
        ? "Agent reply draft returned. Review and edit it before posting."
        : "The returned reply draft no longer matches the focused review context.",
    );
    comments();
    outgoingHandoff = null;
    return;
  }
  if (
    !sameTarget(target, selection) ||
    selectionAction?.kind !== action.kind ||
    !sameTarget(selectionAction.target, selection)
  ) {
    note(
      "Agent returned a draft, but the original selection is no longer open.",
    );
    return;
  }
  const applied =
    returned.kind === "comment"
      ? applyCommentDraft({
          target: selection,
          body: returned.content,
          expectedDraft: action.draft,
        })
      : applySuggestionDraft({
          target: selection,
          replacement: returned.content,
          expectedDraft: action.draft,
        });
  if (!applied)
    note(
      "Agent returned a draft, but your local draft changed; it was preserved.",
    );
  outgoingHandoff = null;
}
let registration,
  connecting = false,
  lifecycle = 0,
  pollEpoch = 0,
  pollTimer;
async function connectTools() {
  if (!session.authorized || registration || connecting) return;
  connecting = true;
  $("webmcp-status").textContent = "Connecting WebMCP…";
  const serial = ++lifecycle;
  const result = await registerWebMCP({
    document,
    api,
    getReviewContext: () =>
      incomingHandoff?.context ??
      reviewContext(
        selected,
        showingBase,
        frame,
        previewState,
        target,
        selectionAction,
        activeCommentId,
      ),
    onDraftComment: (draft) =>
      incomingHandoff
        ? sendIncomingHandoffDraft("comment", draft.body)
        : applyCommentDraft(draft),
    onDraftSuggestion: ({
      target: draftedTarget,
      replacement,
      expectedDraft,
    }) =>
      incomingHandoff
        ? sendIncomingHandoffDraft("suggest", replacement)
        : applySuggestionDraft({
            target: draftedTarget,
            replacement,
            expectedDraft,
          }),
    onDraftReply: (draft) =>
      incomingHandoff ? sendIncomingReplyDraft(draft) : applyReplyDraft(draft),
    onMutation: async (result, route) => {
      await refresh();
      const updated =
        route === "proposals"
          ? current?.state.proposals.some((p) => p.id === result.proposal.id)
          : result.comment.replies.every((reply) =>
              current?.state.comments
                .find((c) => c.id === result.comment.id)
                ?.replies.some((r) => r.id === reply.id),
            );
      note(
        !updated
          ? "Agent change saved; waiting for Viewer sync"
          : route === "proposals"
            ? `Suggested change available in Versions: ${result.proposal.request}`
            : "Agent reply added",
      );
      return !!updated;
    },
  });
  if (serial !== lifecycle) {
    result.dispose();
    return;
  }
  connecting = false;
  registration = result;
  $("webmcp-status").textContent =
    result.status === "registered"
      ? "WebMCP connected · 7 tools · comments and proposals remain human-reviewed"
      : result.status === "unsupported"
        ? "WebMCP unavailable · manual review works normally"
        : "WebMCP registration failed · manual review works normally";
}
async function poll() {
  const epoch = pollEpoch;
  try {
    if (!document.hidden && session.authorized) {
      await refresh();
      await syncOutgoingHandoff();
      $("sync-status").textContent = "Live";
    }
  } catch {
    if (session.authorized)
      $("sync-status").textContent = "Sync failed · retrying";
  }
  if (epoch === pollEpoch) pollTimer = setTimeout(poll, 3000);
}
addEventListener("pagehide", () => {
  ++lifecycle;
  ++pollEpoch;
  registration?.dispose();
  registration = undefined;
  connecting = false;
  clearTimeout(pollTimer);
});
addEventListener("pageshow", (event) => {
  if (event.persisted) {
    safely(async () => {
      await refresh();
      await connectTools();
    })();
    poll();
  }
});
function authorizationChanged(authorized) {
  $("authorization").hidden = authorized;
  $("review-app").hidden = !authorized;
  $("viewer-controls").hidden = !authorized;
  $("copy-access-link").disabled = !authorized;
  $("refresh").disabled = !authorized;
  $("tab-comments").disabled = !authorized;
  $("tab-versions").disabled = !authorized;
  $("sync-status").textContent = authorized ? "Live" : "Authorization required";
  applySession();
  if (authorized) {
    $("authorization-error").textContent = "";
    if (incomingHandoffId)
      safely(async () => {
        await loadIncomingHandoff();
        await connectTools();
      })();
    else connectTools();
    return;
  }
  ++lifecycle;
  registration?.dispose();
  registration = undefined;
  connecting = false;
  $("webmcp-status").textContent =
    "WebMCP paused · authorize this Viewer first";
  $("title").textContent = "Viewer authorization required";
  $("revision").textContent = "";
  $("authorization-error").textContent = AUTH_MESSAGE;
  $("accept").disabled = true;
  $("confirmation").close();
  // Invalidate in-flight refreshes/previews and drafts tied to that session.
  refreshGate.begin();
  refreshGate.generation = -1;
  ++previewSerial;
  clearTimeout(previewTimer);
  previewState.reset();
  annotations = null;
  activeGroup = null;
  activeCommentId = null;
  outgoingHandoff = null;
  outgoingDraftId = null;
  replyDraft = null;
  postingReply = false;
  commentAgentStates.clear();
  setAgentStatus("idle");
  ++annotationSerial;
  frame = null;
  $("preview").removeAttribute("src");
  current = undefined;
  selected = undefined;
  ++diffSerial;
  diffController?.abort();
  diffFile = null;
  setView("preview");
  resetTarget();
}
$("authorize-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("access-link").value;
  $("access-link").value = "";
  $("authorize").disabled = true;
  $("authorization-error").textContent = "Checking authorization…";
  try {
    session.replace(input, location.origin);
    await refresh();
  } catch (error) {
    $("authorization-error").textContent = error.message;
  } finally {
    $("authorize").disabled = false;
  }
};
$("copy-access-link").onclick = safely(async () => {
  try {
    await navigator.clipboard.writeText(session.accessLink(location.origin));
  } catch {
    throw new Error(
      "Copy unavailable. Use the complete access link from the running terminal.",
    );
  }
  note(
    "Private access link copied. Open it in the other browser; do not share it publicly.",
  );
});
addEventListener("hashchange", () => {
  if (!location.hash) return;
  const value = location.hash.slice(1);
  history.replaceState(null, "", location.pathname + location.search);
  safely(async () => {
    session.replace(value, location.origin);
    await refresh();
  })();
});
authorizationChanged(false);
safely(async () => {
  try {
    await refresh();
    await loadIncomingHandoff();
  } catch (error) {
    $("authorization-error").textContent =
      error.code === "authorization_required" ? AUTH_MESSAGE : error.message;
  }
})();
pollTimer = setTimeout(poll, 3000);
