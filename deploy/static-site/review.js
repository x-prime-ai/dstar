const SAMPLES = {
  "dstar-doc": {
    title: "DSTAR Product Brief",
    path: "./samples/dstar-doc/document.html",
  },
  "dstar-rich": {
    title: "The document is the interface",
    path: "./samples/dstar-rich/document.html",
  },
  "dstar-slides": {
    title: "Review the document",
    path: "./samples/dstar-slides/document.html",
  },
  "dstar-ui-design": {
    title: "DSTAR Viewer UI",
    path: "./samples/dstar-ui-design/document.html",
  },
};

const params = new URL(location.href).searchParams;
const id =
  params.get("id") ||
  location.pathname.match(/\/documents\/([^/]+)\/?$/)?.[1] ||
  null;
const sample = SAMPLES[id];
const $ = (selector) => document.querySelector(selector);
const frame = $("#document-frame");
const storageKey = `dstar:static-review:${id}:v1`;
let selection = null;
let focused = null;
let filter = "open";
let replying = null;
let replyDraft = "";

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const safe = (value) => String(value ?? "").slice(0, 20_000);

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(comments) {
  localStorage.setItem(storageKey, JSON.stringify(comments));
  render();
  paint();
}

function date(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function authorHeader(author, createdAt) {
  const wrap = node("div", "message-header");
  wrap.append(
    node(
      "span",
      "avatar",
      String(author || "You")
        .slice(0, 1)
        .toUpperCase(),
    ),
    node("strong", "", author),
    node("time", "", date(createdAt)),
  );
  return wrap;
}

function message(entry) {
  const wrap = node("article", "message");
  wrap.append(
    authorHeader(entry.author, entry.createdAt),
    node("p", "", entry.body),
  );
  return wrap;
}

function update(commentId, change) {
  const items = read();
  const index = items.findIndex((item) => item.id === commentId);
  if (index < 0) return;
  items[index] = change(items[index]);
  write(items);
}

function replyForm(comment) {
  const form = node("form", "reply-form");
  const area = node("textarea");
  area.rows = 3;
  area.placeholder = "Write a reply…";
  area.value = replyDraft;
  area.oninput = () => (replyDraft = area.value);
  const actions = node("div", "actions");
  const cancel = node("button", "", "Cancel");
  const post = node("button", "primary", "Reply");
  cancel.type = "button";
  cancel.onclick = () => {
    replying = null;
    replyDraft = "";
    render();
  };
  actions.append(cancel, post);
  form.append(area, actions);
  form.onsubmit = (event) => {
    event.preventDefault();
    const body = safe(area.value).trim();
    if (!body) return;
    update(comment.id, (item) => ({
      ...item,
      replies: [
        ...(item.replies || []),
        { id: uid(), author: "You", body, createdAt: now() },
      ],
    }));
    replying = null;
    replyDraft = "";
  };
  return form;
}

function thread(comment) {
  const details = node("details", "thread");
  details.dataset.id = comment.id;
  details.open = focused === comment.id;
  details.ontoggle = () => {
    if (details.open && focused !== comment.id) {
      focused = comment.id;
      render();
      paint();
    } else if (!details.open && focused === comment.id) {
      focused = null;
      paint();
    }
  };
  const summary = node("summary");
  const avatar = node(
    "span",
    "avatar",
    comment.author.slice(0, 1).toUpperCase(),
  );
  const identity = node("span", "identity");
  identity.append(
    node("strong", "", comment.author),
    node("small", "", date(comment.createdAt)),
  );
  summary.append(
    avatar,
    identity,
    node("em", "state", comment.status === "resolved" ? "Resolved" : "Open"),
  );
  const content = node("div", "thread-content");
  content.append(message(comment));
  for (const reply of comment.replies || []) content.append(message(reply));
  const actions = node("div", "thread-actions");
  const reply = node("button", "", "Reply");
  const resolve = node(
    "button",
    "",
    comment.status === "open" ? "Resolve" : "Reopen",
  );
  reply.type = resolve.type = "button";
  reply.onclick = () => {
    replying = comment.id;
    replyDraft = "";
    render();
  };
  resolve.onclick = () =>
    update(comment.id, (item) => ({
      ...item,
      status: item.status === "open" ? "resolved" : "open",
    }));
  actions.append(reply, resolve);
  content.append(actions);
  if (replying === comment.id) content.append(replyForm(comment));
  details.append(summary, content);
  return details;
}

function render() {
  const visible = read().filter((item) => item.status === filter);
  $("#comments-summary").textContent =
    `${visible.length} ${filter} thread${visible.length === 1 ? "" : "s"} in this document`;
  $("#comments-empty").hidden = visible.length > 0;
  $("#comments-empty strong").textContent =
    filter === "open" ? "No open comments" : "No resolved comments";
  $("#comments-list").replaceChildren(...visible.map(thread));
}

function stable(value) {
  return (value?.nodeType === 1 ? value : value?.parentElement)?.closest?.(
    "[data-dstar-id]",
  );
}

function textOffset(element, container, offset) {
  const range = frame.contentDocument.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function captureSelection() {
  const selected = frame.contentWindow?.getSelection?.();
  if (!selected?.rangeCount || selected.isCollapsed) return null;
  const range = selected.getRangeAt(0);
  const first = stable(range.startContainer);
  const last = stable(range.endContainer);
  if (!first || first !== last) return null;
  const start = textOffset(first, range.startContainer, range.startOffset);
  const end = textOffset(first, range.endContainer, range.endOffset);
  const exact = range.toString();
  if (start === null || end === null || end <= start || !exact.trim())
    return null;
  return {
    element: first.dataset.dstarId,
    start,
    end,
    exact,
    rect: range.getBoundingClientRect(),
  };
}

function positionButton(target) {
  const rect = frame.getBoundingClientRect();
  const button = $("#selection-comment");
  button.style.left = `${Math.min(innerWidth - 48, rect.left + target.rect.right + 8)}px`;
  button.style.top = `${Math.max(70, rect.top + target.rect.top - 4)}px`;
  button.hidden = false;
}

function clearSelection() {
  selection = null;
  $("#selection-comment").hidden = true;
  $("#comment-composer").hidden = true;
  frame.contentWindow?.getSelection?.()?.removeAllRanges?.();
}

function locate(target) {
  const doc = frame.contentDocument;
  const element = doc?.querySelector(
    `[data-dstar-id="${CSS.escape(target.element)}"]`,
  );
  if (!element) return null;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode;
  let startOffset;
  let endNode;
  let endOffset;
  let current;
  while ((current = walker.nextNode())) {
    const next = cursor + current.data.length;
    if (!startNode && target.start >= cursor && target.start <= next) {
      startNode = current;
      startOffset = target.start - cursor;
    }
    if (target.end >= cursor && target.end <= next) {
      endNode = current;
      endOffset = target.end - cursor;
      break;
    }
    cursor = next;
  }
  if (!startNode || !endNode) return null;
  const range = doc.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    return null;
  }
  return range.toString() === target.exact ? range : null;
}

function paint() {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win?.CSS?.highlights || !doc) return;
  win.CSS.highlights.clear();
  doc.querySelector("#dstar-static-highlight-style")?.remove();
  const style = doc.createElement("style");
  style.id = "dstar-static-highlight-style";
  style.textContent =
    "::highlight(dstar-comments){background:#dce8f2;color:inherit}::highlight(dstar-focused){background:#9dc5e5;color:inherit}";
  doc.head.append(style);
  const normal = [];
  const active = [];
  for (const comment of read().filter((item) => item.status === "open")) {
    const range = locate(comment.target);
    if (range) (comment.id === focused ? active : normal).push(range);
  }
  if (normal.length)
    win.CSS.highlights.set("dstar-comments", new win.Highlight(...normal));
  if (active.length)
    win.CSS.highlights.set("dstar-focused", new win.Highlight(...active));
}

function commentAtPoint(x, y) {
  for (const comment of read().filter((item) => item.status === "open")) {
    const range = locate(comment.target);
    if (
      range &&
      [...range.getClientRects()].some(
        (rect) =>
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom,
      )
    )
      return comment;
  }
  return null;
}

function attach() {
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.addEventListener("mouseup", () =>
    setTimeout(() => {
      const target = captureSelection();
      if (target) {
        selection = target;
        positionButton(target);
      }
    }, 0),
  );
  doc.addEventListener("click", (event) => {
    if (captureSelection()) return;
    const comment = commentAtPoint(event.clientX, event.clientY);
    if (comment) {
      focused = comment.id;
      filter = comment.status;
      render();
      paint();
      return;
    }
    focused = null;
    clearSelection();
    render();
    paint();
  });
  paint();
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) => context.registerTool(tool).catch(() => {});
  register({
    name: "get_document_context",
    description:
      "Read the current DSTAR document, selection and browser-local comment threads.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () =>
      JSON.stringify({
        document: { id, title: sample.title, url: location.href },
        selection: selection && {
          element: selection.element,
          exact: selection.exact,
        },
        focusedComment: read().find((item) => item.id === focused) || null,
        comments: read(),
      }),
  });
  register({
    name: "draft_selection_comment",
    description:
      "Draft a comment for the exact text currently selected in DSTAR. The user must review and post it.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string" } },
      required: ["body"],
      additionalProperties: false,
    },
    execute: async ({ body }) => {
      if (!selection) throw new Error("Select text in the document first");
      $("#comment-body").value = safe(body);
      $("#comment-composer").hidden = false;
      return "Draft opened for user review; it has not been posted.";
    },
  });
  register({
    name: "draft_comment_reply",
    description:
      "Draft a reply to an existing DSTAR comment. The user must review and post it.",
    inputSchema: {
      type: "object",
      properties: { commentId: { type: "string" }, body: { type: "string" } },
      required: ["commentId", "body"],
      additionalProperties: false,
    },
    execute: async ({ commentId, body }) => {
      if (!read().some((item) => item.id === commentId))
        throw new Error("Comment not found");
      focused = commentId;
      replying = commentId;
      replyDraft = safe(body);
      render();
      return "Reply draft opened for user review; it has not been posted.";
    },
  });
}

if (!sample) {
  location.replace("./");
} else {
  document.title = `${sample.title} · DSTAR`;
  $("#document-title").textContent = sample.title;
  frame.src = sample.path;
  frame.addEventListener("load", attach);
  render();
  registerWebMcp();
}

$("#selection-comment").onclick = () => {
  $("#comment-composer").hidden = false;
  $("#comment-body").focus();
};
$("#cancel-comment").onclick = clearSelection;
$("#comment-composer").onsubmit = (event) => {
  event.preventDefault();
  const body = safe($("#comment-body").value).trim();
  if (!body || !selection) return;
  write([
    ...read(),
    {
      id: uid(),
      author: "You",
      createdAt: now(),
      body,
      status: "open",
      target: {
        element: selection.element,
        start: selection.start,
        end: selection.end,
        exact: selection.exact,
      },
      replies: [],
    },
  ]);
  $("#comment-body").value = "";
  clearSelection();
};
for (const button of document.querySelectorAll(".filter"))
  button.onclick = () => {
    filter = button.dataset.filter;
    document
      .querySelectorAll(".filter")
      .forEach((item) => item.classList.toggle("active", item === button));
    render();
  };
for (const button of document.querySelectorAll(".tab"))
  button.onclick = () => {
    const panel = button.dataset.panel;
    document
      .querySelectorAll(".tab")
      .forEach((item) => item.classList.toggle("active", item === button));
    $("#comments-panel").hidden = panel !== "comments";
    $("#versions-panel").hidden = panel !== "versions";
  };
