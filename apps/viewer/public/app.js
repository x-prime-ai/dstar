import { PreviewState } from "./preview-state.js";
import {
  RefreshGate,
  reviewContext,
  selectionFromEvent,
} from "./review-state.js";
import { registerWebMCP } from "./webmcp.js";

const $ = (id) => document.getElementById(id);
const previewState = new PreviewState();
const refreshGate = new RefreshGate();
let previewTimer;
const canAccept = () =>
  previewState.canAccept(selected, current?.state.head, showingBase);
let token = location.hash.slice(1);
if (token) {
  sessionStorage.setItem("dstar-token", token);
  history.replaceState(null, "", "/");
} else token = sessionStorage.getItem("dstar-token");
let current,
  selected,
  frame,
  target,
  showingBase = false,
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
const api = async (path, body, signal) => {
  const response = await fetch(`/api/${path}`, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.code = data.code;
    throw error;
  }
  return data;
};
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
  $("selection").textContent = "Select something to comment";
  $("add-comment").disabled = true;
  $("whole-element").hidden = true;
}
async function preview(id) {
  const serial = ++previewSerial;
  clearTimeout(previewTimer);
  previewState.reset();
  $("accept").disabled = true;
  resetTarget();
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
  selected = current.state.proposals.find((p) => p.id === id);
  if (!keepPreview) showingBase = false;
  $("view-label").textContent = selected
    ? `${showingBase ? "Base" : selected.status === "pending" ? "Candidate" : "Version"} · ${(showingBase ? selected.base : selected.revision).slice(7, 19)}`
    : "No accepted version";
  $("decision").hidden = selected?.status !== "pending";
  $("diff-panel").hidden = !selected;
  $("compare").hidden = !selected?.parent;
  $("compare").textContent = showingBase ? "Show candidate" : "Show base";
  $("accept").disabled = !canAccept();
  $("stale").hidden =
    selected?.status !== "pending" || selected.parent === current.state.head;
  $("diff").replaceChildren();
  if (selected) {
    $("request").textContent = selected.request;
    const bytes = selected.changes.reduce(
        (sum, c) => sum + (c.storage?.size ?? 0),
        0,
      ),
      deltas = selected.changes.filter(
        (c) => c.storage?.encoding === "gzip-delta-v1",
      ).length;
    $("storage").textContent =
      `${selected.changes.length} changed files · ${bytes.toLocaleString()} compressed bytes · ${deltas} deltas · ${selected.diff.anchorRisks.length} comment anchor warnings`;
    for (const file of selected.diff.files)
      $("diff").append(
        el(
          "p",
          `${file.kind}: ${file.path} (${file.beforeBytes} → ${file.afterBytes} bytes)`,
        ),
      );
    $("diff").append(
      el(
        "p",
        `${selected.diff.elementChangeCount} changed elements. Showing up to 200 summaries; text previews are limited to 160 characters. Use the full previews to review layout and content.`,
      ),
    );
    for (const change of selected.diff.elements) {
      $("diff").append(
        el("strong", `${change.id}: ${change.changes.join(", ")}`),
      );
      if (change.changes.includes("text"))
        $("diff").append(
          el(
            "pre",
            `− ${change.before?.text ?? ""}\n+ ${change.after?.text ?? ""}`,
          ),
        );
    }
    if (selected.diff.rewriteRatio > 0)
      $("diff").append(
        el(
          "p",
          `${Math.round(selected.diff.rewriteRatio * 100)}% of previous stable IDs removed. Review comment anchors.`,
        ),
      );
    for (const risk of selected.diff.anchorRisks)
      $("diff").append(
        el("p", `Comment ${risk.comment.slice(0, 8)}: ${risk.status}`),
      );
  }
  document
    .querySelectorAll("[data-proposal]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.proposal === id),
    );
  if (!keepPreview) await preview(id);
}
function comments() {
  $("count").textContent = current.state.comments.filter(
    (c) => c.status === "open",
  ).length;
  $("comments").replaceChildren();
  for (const c of [...current.state.comments].reverse()) {
    const article = el("article", undefined, "comment");
    article.append(
      el(
        "small",
        `${c.author} · ${c.target.element} · ${c.target.revision.slice(7, 15)}`,
      ),
      el("p", c.body),
    );
    if (c.target.selector.type === "text-range")
      article.append(el("blockquote", c.target.selector.exact));
    article.append(
      el(
        "span",
        `${c.status} · ${current.revision ? `${current.resolutions[c.id]?.status ?? "orphaned"} on head` : "no accepted head"}`,
        "badge",
      ),
    );
    const view = el("button", "View original");
    view.onclick = safely(() =>
      select(
        current.state.proposals.find((p) => p.revision === c.target.revision)
          ?.id,
      ),
    );
    article.append(view);
    for (const r of c.replies) {
      const reply = el("div", undefined, "reply");
      reply.append(el("small", r.author), el("p", r.body));
      article.append(reply);
    }
    const reply = el("button", "Reply");
    reply.onclick = safely(async () => {
      const body = await ask("Reply to comment", c.body, true);
      if (body?.trim()) {
        await api(`comments/${c.id}/reply`, { body });
        await refresh();
      }
    });
    article.append(reply);
    if (c.status === "open") {
      const resolve = el("button", "Resolve");
      resolve.onclick = safely(async () => {
        await api(`comments/${c.id}/resolve`, { stateId: current.stateId });
        await refresh();
      });
      article.append(resolve);
    }
    $("comments").append(article);
  }
}
async function refresh({ retryPreview = false } = {}) {
  const serial = refreshGate.begin();
  const next = await api("state");
  if (!refreshGate.accept(serial, next.state.generation)) return;
  if (current?.stateId === next.stateId) {
    if (retryPreview && previewState.status === "failed")
      await preview(showingBase ? selected?.parent : selected?.id);
    return;
  }
  const previousId = selected?.id;
  current = next;
  $("title").textContent = current.title;
  $("revision").textContent = current.revision
    ? `HEAD ${current.revision.slice(7, 23)}`
    : "No accepted revision yet";
  for (const [container, status] of [
    ["proposals", "pending"],
    ["history", "accepted"],
    ["rejected", "rejected"],
  ]) {
    $(container).replaceChildren();
    for (const p of [...current.state.proposals]
      .reverse()
      .filter((p) => p.status === status)) {
      const button = el("button", `${p.request}\n${p.revision.slice(7, 15)}`);
      button.dataset.proposal = p.id;
      button.onclick = safely(() => select(p.id));
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
  if (retryPreview && previewState.status === "failed")
    await preview(showingBase ? selected?.parent : selected?.id);
}
$("refresh").onclick = safely(() => refresh({ retryPreview: true }));
$("width").onchange = () => {
  $("preview").style.width = $("width").value;
};
$("compare").onclick = safely(async () => {
  showingBase = !showingBase;
  $("compare").textContent = showingBase ? "Show candidate" : "Show base";
  $("view-label").textContent = showingBase
    ? `Base · ${selected.base.slice(7, 19)}`
    : `Candidate · ${selected.revision.slice(7, 19)}`;
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
    if (previewState.status === "failed")
      note("Preview resources failed to load. Refresh before accepting.");
    return;
  }
  const selection = selectionFromEvent(
    event,
    $("preview").contentWindow,
    frame,
    previewState,
  );
  if (!selection) return;
  target = selection;
  $("selection").textContent =
    target.selector.type === "element"
      ? `Element: ${target.element}`
      : `“${target.selector.exact.slice(0, 140)}” · ${target.element}`;
  $("add-comment").disabled = false;
  $("whole-element").hidden = target.selector.type === "element";
});
$("whole-element").onclick = () => {
  if (target) {
    target = { ...target, selector: { type: "element" } };
    $("selection").textContent = `Element: ${target.element}`;
    $("whole-element").hidden = true;
  }
};
$("comment-form").onsubmit = safely(async (event) => {
  event.preventDefault();
  if (!target) return;
  const body = $("body").value;
  await api("comments", { target, body });
  if ($("body").value === body) $("body").value = "";
  note("Comment added to the selected revision");
  await refresh();
});
safely(refresh)();
let registration,
  lifecycle = 0,
  pollEpoch = 0,
  pollTimer;
async function connectTools() {
  const serial = ++lifecycle;
  const result = await registerWebMCP({
    document,
    api,
    getReviewContext: () =>
      reviewContext(selected, showingBase, frame, previewState, target),
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
  registration = result;
  $("webmcp-status").textContent =
    result.status === "registered"
      ? "WebMCP connected · 4 tools · proposals only"
      : result.status === "unsupported"
        ? "WebMCP unavailable · manual review works normally"
        : "WebMCP registration failed · manual review works normally";
}
async function poll() {
  const epoch = pollEpoch;
  try {
    if (!document.hidden) {
      await refresh();
      $("sync-status").textContent = "Live";
    }
  } catch {
    $("sync-status").textContent = "Sync failed · retrying";
  }
  if (epoch === pollEpoch) pollTimer = setTimeout(poll, 3000);
}
addEventListener("pagehide", () => {
  ++lifecycle;
  ++pollEpoch;
  registration?.dispose();
  clearTimeout(pollTimer);
});
addEventListener("pageshow", (event) => {
  if (event.persisted) {
    connectTools();
    poll();
  }
});
connectTools();
pollTimer = setTimeout(poll, 3000);
