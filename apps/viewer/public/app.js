import { PreviewState } from "./preview-state.js";
import {
  RefreshGate,
  reviewContext,
  selectionMessageFromEvent,
  selectionButtonPosition,
  commentGroups,
  annotationEventFromFrame,
} from "./review-state.js";
import { registerWebMCP } from "./webmcp.js";
import { AUTH_MESSAGE, ViewerSession } from "./session.js";
import { renderFileDiff } from "./diff-view.js";

const $ = (id) => document.getElementById(id);
const previewState = new PreviewState();
const refreshGate = new RefreshGate();
let previewTimer;
const canAccept = () =>
  session.authorized &&
  viewMode === "preview" &&
  previewState.canAccept(selected, current?.state.head, showingBase);
const session = new ViewerSession({
  fetch,
  storage: () => sessionStorage,
  onAuthorization: authorizationChanged,
});
session.restore(location, history);
let current,
  selected,
  frame,
  target,
  selectionAction,
  commentTarget,
  commentTriggerTarget,
  activeTab = "comments-panel",
  viewMode = "preview",
  diffFile = null,
  diffSerial = 0,
  diffController = null,
  activeGroup = null,
  annotations = null,
  annotationSerial = 0,
  showingBase = false,
  postingComment = false,
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
function resetTarget() {
  target = null;
  selectionAction = null;
  commentTarget = null;
  commentTriggerTarget = null;
  $("selection-actions").hidden = true;
  $("comment-form").hidden = true;
  $("selection").textContent = "";
  $("add-comment").disabled = true;
  $("whole-element").hidden = true;
}
function setPanel(panel, open, focus = false) {
  activeTab = panel;
  $("review-sidebar").hidden = !open;
  $("toggle-review").setAttribute("aria-expanded", String(open));
  for (const [id, tab] of [
    ["comments-panel", "tab-comments"],
    ["navigation", "tab-versions"],
  ]) {
    $(id).hidden = id !== panel;
    $(tab).setAttribute("aria-selected", String(id === panel));
    $(tab).tabIndex = id === panel ? 0 : -1;
  }
  $("selection-actions").hidden = true;
  if (focus) {
    if (open)
      $(panel === "comments-panel" ? "tab-comments" : "tab-versions").focus();
    else $("toggle-review").focus();
  }
  sendAnnotations();
}
$("toggle-review").onclick = () =>
  setPanel(activeTab, $("review-sidebar").hidden, true);
$("close-review").onclick = () => setPanel(activeTab, false, true);
for (const [panel, tab] of [
  ["comments-panel", "tab-comments"],
  ["navigation", "tab-versions"],
]) {
  $(tab).onclick = () => setPanel(panel, true);
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
setPanel(activeTab, document.documentElement.clientWidth > 760);
function describeTarget() {
  $("selection").textContent =
    commentTarget.selector.type === "element"
      ? `Element: ${commentTarget.element}`
      : `“${(commentTarget.selector.type === "text-ranges"
          ? commentTarget.selector.ranges.map((part) => part.exact).join(" ")
          : commentTarget.selector.exact
        ).slice(0, 240)}”`;
  $("whole-element").hidden = commentTarget.selector.type !== "text-range";
}
function composeComment(selectedTarget = target) {
  if (!selectedTarget || !session.authorized || previewState.status !== "ready")
    return;
  setView("preview");
  setPanel("comments-panel", true);
  if (commentTarget && $("body").value.trim()) {
    note("Post or cancel your current comment before starting another.");
  } else {
    commentTarget = selectedTarget;
    describeTarget();
  }
  $("comment-form").hidden = false;
  $("comments-empty").hidden = true;
  $("add-comment").disabled = postingComment || !$("body").value.trim();
  $("body").focus();
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
  target = selectedTarget;
  selectionAction = { kind: "suggest", target: selectedTarget };
  $("selection-actions").hidden = true;
  note(
    "Suggestion ready. Tell your browser agent how this selection should change.",
  );
};
$("ask-agent-comment").onclick = () => {
  if (!commentTarget || postingComment) return;
  target = commentTarget;
  selectionAction = { kind: "comment", target: commentTarget };
  note(
    "Comment request ready. Tell your browser agent what the comment should say.",
  );
};
$("cancel-comment").onclick = () => {
  $("body").value = "";
  resetTarget();
  $("comments-empty").hidden = !!current?.state.comments.length;
  $("tab-comments").focus();
};
$("body").oninput = () => {
  $("add-comment").disabled =
    postingComment || !commentTarget || !$("body").value.trim();
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
    note("Preview did not finish loading. Refresh before accepting.");
  }, 20000);
  // iframe load also fires for HTTP error pages; it is never approval evidence.
  $("preview").src = frame.url;
}
async function select(id, { keepPreview = false } = {}) {
  const previous = selected?.id;
  selected = current.state.proposals.find((p) => p.id === id);
  if (!keepPreview) showingBase = false;
  $("view-label").textContent = selected
    ? showingBase
      ? "Base version"
      : selected.status === "pending"
        ? "Proposed changes"
        : selected.id === current.state.head
          ? "Accepted document"
          : "Previous version"
    : "No accepted version";
  $("decision").hidden = selected?.status !== "pending";
  $("version-detail").hidden = !selected;
  $("view-changes").disabled = !selected;
  $("change-count").textContent = selected?.diff.files.length ?? 0;
  $("change-count").hidden = !selected?.diff.files.length;
  $("compare").hidden = !selected?.parent;
  $("compare").textContent = showingBase ? "Show candidate" : "Show base";
  $("accept").disabled = !canAccept();
  $("stale").hidden =
    selected?.status !== "pending" || selected.parent === current.state.head;
  if (selected) {
    $("version-request").textContent = selected.request;
    $("version-summary").textContent =
      `${selected.status} · ${selected.diff.files.length} changed ${selected.diff.files.length === 1 ? "file" : "files"}`;
    const bytes = selected.changes.reduce(
        (sum, c) => sum + (c.storage?.size ?? 0),
        0,
      ),
      deltas = selected.changes.filter(
        (c) => c.storage?.encoding === "gzip-delta-v1",
      ).length;
    $("storage").textContent =
      `${selected.changes.length} changed files · ${bytes.toLocaleString()} compressed bytes · ${deltas} deltas · ${selected.diff.anchorRisks.length} comment anchor warnings`;
  }
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
  for (const [name, panel] of [
    ["preview", "preview-panel"],
    ["changes", "diff-panel"],
  ]) {
    $(`view-${name}`).setAttribute("aria-selected", String(mode === name));
    $(`view-${name}`).tabIndex = mode === name ? 0 : -1;
    $(panel).hidden = mode !== name;
  }
  $("preview-controls").hidden = mode !== "preview";
  $("view-label").hidden = mode !== "preview";
  $("selection-actions").hidden = true;
  $("accept").disabled = !canAccept();
  $("decision-hint").hidden = mode !== "changes";
  if (mode === "changes") {
    diffOverview();
    if (!diffFile) loadDiffFile(selected.diff.files[0]?.path);
  }
}
for (const mode of ["preview", "changes"]) {
  $(`view-${mode}`).onclick = () => setView(mode);
  $(`view-${mode}`).onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "preview"
        : event.key === "End"
          ? "changes"
          : mode === "preview"
            ? "changes"
            : "preview";
    if ($(`view-${next}`).disabled) return;
    setView(next);
    $(`view-${next}`).focus();
  };
}
$("inspect-changes").onclick = () => {
  setView("changes");
  if (document.documentElement.clientWidth <= 760) setPanel(activeTab, false);
};
function diffOverview() {
  if (!selected) return;
  $("diff-title").textContent = selected.request;
  $("diff-versions").textContent =
    `${selected.base ? `Base ${selected.base.slice(7, 15)}` : "Empty document"} → ${selected.status === "pending" ? "Proposed" : "Version"} ${selected.revision.slice(7, 15)}`;
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
  const groups = commentGroups(current.state.comments)
    .map((group) => ({
      id: group.id,
      number: group.number,
      resolved: !group.openCount,
      anchors: group.comments.filter(located).map((c) => ({
        type: c.target.selector.type,
        ...annotations.anchors[c.id],
      })),
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
    comments();
    sendAnnotations();
  } catch (error) {
    if (serial !== annotationSerial || frame !== expected) return;
    annotations = null;
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
  const group = commentGroups(current?.state.comments ?? []).find(
    (g) => g.id === id,
  );
  if (!group || !group.comments.some(located)) return;
  setView("preview");
  activeGroup = id;
  setPanel("comments-panel", true);
  document.querySelectorAll(".comment-group").forEach((card) => {
    const active = card.dataset.group === id;
    card.classList.toggle("active", active);
    card
      .querySelector(".group-location")
      .setAttribute("aria-pressed", String(active));
  });
  const card = $(`comment-group-${group.number}`);
  if (card) {
    let ancestor = card.parentElement;
    while (ancestor && ancestor !== $("comments-panel")) {
      if (ancestor.tagName === "DETAILS") ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    if (!fromList) {
      card.scrollIntoView({ block: "nearest" });
      card.querySelector(".group-location").focus({ preventScroll: true });
    }
  }
  // On phones, leave the document visible after choosing a list location.
  if (fromList && document.documentElement.clientWidth <= 760)
    setPanel(activeTab, false);
  sendAnnotations(fromList ? id : null);
}
function commentThread(c) {
  const article = el("article", undefined, "comment");
  const author = el("div", undefined, "comment-author");
  author.append(
    el("span", c.author.slice(0, 1).toUpperCase(), "avatar"),
    el("strong", c.author),
  );
  if (c.status !== "open") author.append(el("span", "Resolved", "badge"));
  article.append(author);
  if (c.target.selector.type !== "element")
    article.append(
      el(
        "blockquote",
        c.target.selector.type === "text-ranges"
          ? c.target.selector.ranges.map((part) => part.exact).join(" … ")
          : c.target.selector.exact,
      ),
    );
  article.append(el("p", c.body));
  for (const r of c.replies) {
    const reply = el("div", undefined, "reply");
    reply.append(el("small", r.author), el("p", r.body));
    article.append(reply);
  }
  const actions = el("div", undefined, "comment-actions");
  const reply = el("button", "Reply");
  reply.onclick = safely(async () => {
    const body = await ask("Reply to comment", c.body, true);
    if (body?.trim()) {
      await api(`comments/${c.id}/reply`, { body });
      await refresh();
    }
  });
  actions.append(reply);
  if (c.status === "open") {
    const resolve = el("button", "Resolve");
    resolve.onclick = safely(async () => {
      await api(`comments/${c.id}/resolve`, { stateId: current.stateId });
      await refresh();
    });
    actions.append(resolve);
  }
  const view = el("button", "View original");
  view.onclick = safely(async () => {
    const proposal = current.state.proposals.find(
      (p) => p.revision === c.target.revision,
    );
    if (!proposal) return note("The original version is unavailable.");
    await select(proposal.id);
  });
  actions.append(view);
  article.append(actions);
  if (annotations && !located(c))
    article.append(
      el("small", "Not located in this version", "anchor-warning"),
    );
  return article;
}
function comments() {
  const list = current.state.comments,
    groups = commentGroups(list);
  const open = list.filter((c) => c.status === "open").length;
  $("count").textContent = open;
  $("count").hidden = !open;
  const pending = current.state.proposals.filter(
    (p) => p.status === "pending",
  ).length;
  $("review-count").textContent = open + pending;
  $("review-count").hidden = !open && !pending;
  $("comments-empty").hidden = !!list.length || !$("comment-form").hidden;
  $("comments-summary").textContent = groups.length
    ? `${open} open · ${groups.length} ${groups.length === 1 ? "location" : "locations"}`
    : "Comments are grouped by location.";
  const expanded = new Set(
    [...$("comments").querySelectorAll("details[open]")].map((d) => d.id),
  );
  const resolved = el("details", undefined, "comment-section");
  resolved.id = "resolved-groups";
  const elsewhere = el("details", undefined, "comment-section");
  elsewhere.id = "unlocated-groups";
  let resolvedCount = 0,
    elsewhereCount = 0;
  $("comments").replaceChildren();
  for (const group of groups) {
    const card = el("section", undefined, "comment-group");
    card.id = `comment-group-${group.number}`;
    card.dataset.group = group.id;
    card.classList.toggle("active", group.id === activeGroup);
    const available = group.comments.some(located);
    const location = el("button", undefined, "group-location");
    location.setAttribute(
      "aria-label",
      `Show comment location ${group.number} in document`,
    );
    location.setAttribute("aria-pressed", String(group.id === activeGroup));
    location.disabled = !available;
    location.title = available
      ? "Show in document"
      : "Location unavailable in this version";
    const quoted = group.comments.find(
      (c) => c.target.selector.type !== "element",
    );
    const label =
      annotations?.labels[group.id] ||
      (quoted?.target.selector.type === "text-ranges"
        ? quoted.target.selector.ranges[0]?.exact
        : quoted?.target.selector.exact) ||
      group.id.replace(/[-_]/g, " ");
    location.append(
      el("span", group.number, "location-number"),
      el("span", label, "location-label"),
    );
    location.onclick = () => focusGroup(group.id);
    card.append(location);
    const count = group.comments.length;
    card.append(
      el(
        "p",
        `${count} ${count === 1 ? "thread" : "threads"}${group.openCount ? ` · ${group.openCount} open` : " · Resolved"}`,
        "group-caption",
      ),
    );
    const closed = el("details", undefined, "resolved-threads");
    closed.id = `resolved-threads-${group.number}`;
    const closedCount = count - group.openCount;
    closed.append(
      el(
        "summary",
        `${closedCount} resolved ${closedCount === 1 ? "thread" : "threads"}`,
      ),
    );
    for (const c of group.comments) {
      if (c.status !== "open" && group.openCount)
        closed.append(commentThread(c));
      else card.append(commentThread(c));
    }
    if (closedCount && group.openCount) card.append(closed);
    if (annotations && !available) {
      elsewhere.append(card);
      elsewhereCount++;
    } else if (!group.openCount) {
      resolved.append(card);
      resolvedCount++;
    } else $("comments").append(card);
  }
  if (resolvedCount) {
    resolved.prepend(el("summary", `Resolved locations · ${resolvedCount}`));
    $("comments").append(resolved);
  }
  if (elsewhereCount) {
    elsewhere.prepend(el("summary", `Not in this version · ${elsewhereCount}`));
    $("comments").append(elsewhere);
  }
  $("comments")
    .querySelectorAll("details")
    .forEach((d) => {
      d.open = expanded.has(d.id) || !!d.querySelector(".comment-group.active");
    });
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
  $("title").textContent = current.title;
  $("revision").textContent = current.revision
    ? `HEAD ${current.revision.slice(7, 23)}`
    : "No accepted revision yet";
  const pending = current.state.proposals.filter(
    (p) => p.status === "pending",
  ).length;
  $("proposal-count").textContent = pending;
  $("proposal-count").hidden = !pending;
  $("tab-versions").title =
    `${pending} ${pending === 1 ? "proposal" : "proposals"} to review`;
  for (const [container, status] of [
    ["proposals", "pending"],
    ["history", "accepted"],
    ["rejected", "rejected"],
  ]) {
    $(container).replaceChildren();
    for (const p of [...current.state.proposals]
      .reverse()
      .filter((p) => p.status === status)) {
      const button = el("button");
      button.append(
        el("strong", p.request),
        el(
          "small",
          `${p.id === current.state.head ? "Current · " : ""}${p.revision.slice(7, 15)}`,
        ),
      );
      button.dataset.proposal = p.id;
      button.onclick = safely(async () => {
        await select(p.id);
        if (document.documentElement.clientWidth <= 760)
          setPanel("navigation", false);
      });
      $(container).append(button);
    }
    if (!$(container).children.length)
      $(container).append(
        el(
          "p",
          status === "pending" ? "All caught up" : "No versions yet",
          "hint",
        ),
      );
  }
  comments();
  const id =
    previousId ??
    current.state.head ??
    current.state.proposals.find((p) => p.status === "pending")?.id;
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
$("compare").onclick = safely(async () => {
  showingBase = !showingBase;
  $("compare").textContent = showingBase ? "Show candidate" : "Show base";
  $("view-label").textContent = showingBase
    ? "Base version"
    : selected.status === "pending"
      ? "Proposed changes"
      : "Accepted document";
  await preview(showingBase ? selected.parent : selected.id);
});
for (const action of ["accept", "reject"])
  $(action).onclick = safely(async () => {
    if (action === "accept" && !canAccept()) return;
    const proposal = selected,
      stateId = current.stateId,
      serial = previewSerial;
    if (
      !(await ask(
        `${action === "accept" ? "Accept" : "Reject"} this version?`,
        `Candidate ${proposal.revision}. This decision applies only to these exact files.`,
      ))
    )
      return;
    if (action === "accept" && (serial !== previewSerial || !canAccept()))
      return;
    await api(`proposals/${proposal.id}/${action}`, {
      revision: proposal.revision,
      stateId,
    });
    note(action === "accept" ? "Version accepted" : "Proposal rejected");
    await refresh();
  });
for (const [button, direction] of [
  ["previous-slide", -1],
  ["next-slide", 1],
])
  $(button).onclick = () => {
    if (frame)
      $("preview").contentWindow.postMessage(
        { kind: "dstar-slide", direction, capability: frame.capability },
        "*",
      );
  };
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
      note("Preview resources failed to load. Refresh before accepting.");
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
    describeTarget();
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
    await api("comments", { target: submittedTarget, body });
    if (commentTarget === submittedTarget && $("body").value === body) {
      $("body").value = "";
      resetTarget();
    }
    note("Comment added");
    await refresh();
    focusGroup(submittedTarget.element, false);
  } finally {
    postingComment = false;
    $("add-comment").textContent = "Post comment";
    $("cancel-comment").disabled = false;
    $("add-comment").disabled = !commentTarget || !$("body").value.trim();
  }
});
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
      reviewContext(
        selected,
        showingBase,
        frame,
        previewState,
        target,
        selectionAction,
      ),
    onDraftComment: ({ target: draftedTarget, body }) => {
      if ($("body").value.trim()) return false;
      target = draftedTarget;
      selectionAction = null;
      composeComment(draftedTarget);
      $("body").value = body;
      $("add-comment").disabled = false;
      $("body").focus();
      note("Agent comment draft is ready for review.");
      return true;
    },
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
            ? `Proposal available in review queue: ${result.proposal.request}`
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
      ? "WebMCP connected · 5 tools · comments and proposals remain human-reviewed"
      : result.status === "unsupported"
        ? "WebMCP unavailable · manual review works normally"
        : "WebMCP registration failed · manual review works normally";
}
async function poll() {
  const epoch = pollEpoch;
  try {
    if (!document.hidden && session.authorized) {
      await refresh();
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
  $("copy-access-link").disabled = !authorized;
  $("refresh").disabled = !authorized;
  $("toggle-review").disabled = !authorized;
  $("sync-status").textContent = authorized ? "Live" : "Authorization required";
  if (authorized) {
    $("authorization-error").textContent = "";
    connectTools();
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
  // Invalidate in-flight refreshes/previews without erasing a comment draft.
  refreshGate.begin();
  refreshGate.generation = -1;
  ++previewSerial;
  clearTimeout(previewTimer);
  previewState.reset();
  annotations = null;
  activeGroup = null;
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
  } catch (error) {
    $("authorization-error").textContent =
      error.code === "authorization_required" ? AUTH_MESSAGE : error.message;
  }
})();
pollTimer = setTimeout(poll, 3000);
