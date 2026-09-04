import {
  decideProposal,
  initialVersionState,
  normalizeVersionState,
  revisionOf,
  validateCandidateFiles,
} from "./review-state.mjs";

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
    title: "Why we built DSTAR",
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
const versionStorageKey = `dstar:static-versions:${id}:v1`;
let selection = null;
let focused = null;
let filter = "open";
let replying = null;
let replyDraft = "";
let versionState = null;
let previewing = null;
let sourceBase = null;
let slides = [];
let activeSlide = 0;
const registrationController = new AbortController();

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const safe = (value) => String(value ?? "").slice(0, 20_000);

function shortRevision(revision) {
  return revision?.replace("sha256:", "").slice(0, 8) || "unknown";
}

function announce(message) {
  $("#status").textContent = message;
}

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

function persistVersions() {
  localStorage.setItem(versionStorageKey, JSON.stringify(versionState));
}

function candidateDocument(html, css) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const base of parsed.querySelectorAll("base")) base.remove();
  const base = parsed.createElement("base");
  base.href = sourceBase;
  parsed.head.prepend(base);
  for (const link of parsed.querySelectorAll('link[rel~="stylesheet"]')) {
    if (
      /^(?:\.\/)?styles\.css(?:[?#].*)?$/.test(link.getAttribute("href") || "")
    )
      link.remove();
  }
  const style = parsed.createElement("style");
  style.id = "dstar-version-styles";
  style.textContent = css;
  parsed.head.append(style);
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

function validateCandidateDocument(html, css) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const errors = [];
  if (!parsed.body || !parsed.body.children.length)
    errors.push("document.html must contain visible body content");
  if (parsed.querySelector("parsererror"))
    errors.push("document.html is invalid");
  if (
    parsed.querySelector(
      'script, iframe, object, embed, base, meta[http-equiv="refresh" i]',
    )
  )
    errors.push("active or document-rebasing elements are not allowed");
  const ids = new Set();
  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name))
        errors.push("inline event handlers are not allowed");
      if (
        /^(?:href|src|srcset|action|formaction|poster)$/i.test(
          attribute.name,
        ) &&
        /^(?:https?:|javascript:|data:text\/html)/i.test(attribute.value.trim())
      )
        errors.push("remote or executable resource URLs are not allowed");
      if (
        attribute.name.toLowerCase() === "style" &&
        /(?:@import|url\(\s*["']?https?:)/i.test(attribute.value)
      )
        errors.push("remote inline-style resources are not allowed");
    }
    const stableId = element.getAttribute("data-dstar-id");
    if (stableId) {
      if (ids.has(stableId))
        errors.push(`duplicate data-dstar-id: ${stableId}`);
      ids.add(stableId);
    }
  }
  if (!ids.size) errors.push("at least one data-dstar-id anchor is required");
  if (/(?:@import|url\(\s*["']?https?:)/i.test(css))
    errors.push("remote CSS resources are not allowed");
  if (/<\/style/i.test(css))
    errors.push("CSS cannot close its style container");
  return [...new Set(errors)];
}

function showDocument(version) {
  frame.srcdoc = candidateDocument(version.html, version.css);
}

function slideTitle(slide, index) {
  const heading = slide.querySelector("h1, h2, h3");
  return (
    safe(heading?.textContent).replace(/\s+/g, " ").trim() ||
    `Slide ${index + 1}`
  );
}

function showSlide(index, announceChange = false) {
  if (!slides.length) return;
  activeSlide = (index + slides.length) % slides.length;
  slides.forEach((slide, itemIndex) => {
    slide.style.display = itemIndex === activeSlide ? "" : "none";
    slide.setAttribute("aria-hidden", String(itemIndex !== activeSlide));
  });
  for (const button of document.querySelectorAll("#slide-list button")) {
    const current = Number(button.dataset.slide) === activeSlide;
    if (current) {
      button.setAttribute("aria-current", "page");
      button.scrollIntoView({ block: "nearest" });
    } else button.removeAttribute("aria-current");
  }
  $("#slide-position").textContent = `${activeSlide + 1} / ${slides.length}`;
  frame.contentWindow?.scrollTo?.(0, 0);
  clearSelection();
  paint();
  if (announceChange) announce(`Slide ${activeSlide + 1} of ${slides.length}.`);
}

function moveSlide(direction) {
  if (slides.length > 1) showSlide(activeSlide + direction, true);
}

function renderSlideRail() {
  const doc = frame.contentDocument;
  slides =
    doc?.body?.dataset.dstarMode === "slides"
      ? [...doc.querySelectorAll("[data-dstar-slide]")]
      : [];
  const enabled = slides.length > 1;
  $("#slide-rail").hidden = !enabled;
  $("#slide-controls").hidden = !enabled;
  if (!enabled) {
    $("#slide-list").replaceChildren();
    return;
  }
  activeSlide = Math.min(activeSlide, slides.length - 1);
  $("#slide-list").replaceChildren(
    ...slides.map((slide, index) => {
      const title = slideTitle(slide, index);
      const button = node("button");
      button.type = "button";
      button.dataset.slide = String(index);
      button.setAttribute("aria-label", `Open slide ${index + 1}: ${title}`);
      const thumbnail = node("span", "slide-thumbnail");
      thumbnail.append(node("b", "", title));
      const copy = node("span", "slide-rail-copy");
      copy.append(
        node("b", "", String(index + 1).padStart(2, "0")),
        node("span", "slide-rail-title", title),
      );
      button.append(thumbnail, copy);
      button.onclick = () => showSlide(index, true);
      const item = node("li");
      item.append(button);
      return item;
    }),
  );
  showSlide(activeSlide);
}

function activatePanel(panel) {
  document
    .querySelectorAll(".tab")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.panel === panel),
    );
  $("#comments-panel").hidden = panel !== "comments";
  $("#versions-panel").hidden = panel !== "versions";
}

function versionCard({
  title,
  detail,
  summary,
  state,
  className = "",
  actions = [],
}) {
  const card = node("article", `version-card ${className}`.trim());
  const header = node("header");
  const dot = node("span", "version-dot");
  const copy = node("div");
  copy.append(node("strong", "", title), node("small", "", detail));
  header.append(dot, copy, node("em", "state", state));
  card.append(header);
  if (summary) card.append(node("p", "", summary));
  if (actions.length) {
    const wrap = node("div", "version-actions");
    for (const [label, handler] of actions) {
      const button = node("button", "", label);
      button.type = "button";
      button.onclick = handler;
      wrap.append(button);
    }
    card.append(wrap);
  }
  return card;
}

function renderVersions() {
  if (!versionState) return;
  const pending = versionState.proposals
    .filter((proposal) => proposal.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rejected = versionState.proposals
    .filter((proposal) => proposal.status === "rejected")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#pending-count").textContent = pending.length
    ? `${pending.length} waiting`
    : "Up to date";
  const cards = [];
  for (const proposal of pending) {
    cards.push(
      versionCard({
        title: proposal.title || "Suggested update",
        detail: `${proposal.author || "External agent"} · ${date(proposal.createdAt)} · ${shortRevision(proposal.revision)}`,
        summary: proposal.summary,
        state: "Waiting",
        className: `pending${previewing === proposal.id ? " reviewing" : ""}`,
        actions: [
          ["Review", () => previewProposal(proposal.id)],
          ["Reject", () => applyDecision(proposal.id, "rejected")],
          ["Accept", () => applyDecision(proposal.id, "accepted")],
        ],
      }),
    );
  }
  cards.push(
    versionCard({
      title: "Current version",
      detail: `${versionState.current.acceptedAt ? `Accepted ${date(versionState.current.acceptedAt)}` : "Published sample"} · ${shortRevision(versionState.current.revision)}`,
      state: "Current",
      className: "current",
      actions: previewing ? [["View current", returnToCurrent]] : [],
    }),
  );
  for (const previous of versionState.history) {
    cards.push(
      versionCard({
        title: "Previous version",
        detail: `${previous.acceptedAt ? date(previous.acceptedAt) : "Original"} · ${shortRevision(previous.revision)}`,
        state: "Earlier",
      }),
    );
  }
  for (const proposal of rejected) {
    cards.push(
      versionCard({
        title: proposal.title || "Declined suggestion",
        detail: `${date(proposal.decidedAt || proposal.createdAt)} · ${shortRevision(proposal.revision)}`,
        summary: proposal.summary,
        state: "Declined",
        className: "rejected",
      }),
    );
  }
  $("#versions-list").replaceChildren(...cards);
}

function previewProposal(proposalId) {
  const proposal = versionState?.proposals.find(
    (item) => item.id === proposalId && item.status === "pending",
  );
  if (!proposal) return;
  previewing = proposal.id;
  showDocument(proposal);
  $("#review-summary").textContent = proposal.summary;
  $("#review-bar").hidden = false;
  $("#accept-version").onclick = () => applyDecision(proposal.id, "accepted");
  $("#reject-version").onclick = () => applyDecision(proposal.id, "rejected");
  activatePanel("versions");
  renderVersions();
  announce(
    "Suggested version opened for review. The current version is unchanged.",
  );
}

function returnToCurrent() {
  previewing = null;
  $("#review-bar").hidden = true;
  showDocument(versionState.current);
  renderVersions();
  announce("Returned to the current version.");
}

function applyDecision(proposalId, decision) {
  versionState = decideProposal(versionState, proposalId, decision, now());
  persistVersions();
  previewing = null;
  $("#review-bar").hidden = true;
  showDocument(versionState.current);
  renderVersions();
  announce(
    decision === "accepted"
      ? "Update accepted. It is now the current version."
      : "Suggestion rejected. The current version was not changed.",
  );
}

async function loadVersions() {
  sourceBase = new URL(`./samples/${id}/`, document.baseURI).href;
  const [htmlResponse, cssResponse] = await Promise.all([
    fetch(new URL("document.html", sourceBase)),
    fetch(new URL("styles.css", sourceBase)),
  ]);
  if (!htmlResponse.ok || !cssResponse.ok)
    throw new Error("Published document files could not be loaded");
  const html = await htmlResponse.text();
  const css = await cssResponse.text();
  const published = {
    revision: await revisionOf(html, css),
    html,
    css,
    publishedAt: now(),
  };
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(versionStorageKey) || "null");
  } catch {
    stored = null;
  }
  versionState = normalizeVersionState(stored, published);
  if (
    !versionState.current.proposalId &&
    versionState.current.revision !== published.revision
  )
    versionState = initialVersionState(published);
  persistVersions();
  showDocument(versionState.current);
  renderVersions();
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
  renderSlideRail();
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
  doc.addEventListener("keydown", (event) => {
    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key) &&
      !event.target?.closest?.(
        'input,textarea,select,button,[contenteditable="true"]',
      )
    ) {
      event.preventDefault();
      moveSlide(["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
    }
  });
  paint();
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) =>
    context
      .registerTool(tool, { signal: registrationController.signal })
      .catch(() => {});
  register({
    name: "get_review_context",
    description:
      "Read the exact DSTAR review context: current immutable revision, selection, focused comment, pending suggestions and Owner capabilities.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () =>
      JSON.stringify({
        document: { id, title: sample.title, url: location.href },
        session: {
          role: "owner",
          displayName: "You",
          capabilities: ["read", "comment", "reply", "propose", "decide"],
        },
        currentRevision: versionState.current.revision,
        reviewingRevision:
          versionState.proposals.find((item) => item.id === previewing)
            ?.revision || null,
        selection:
          selection &&
          Object.fromEntries(
            Object.entries(selection).filter(([key]) => key !== "rect"),
          ),
        focusedComment: read().find((item) => item.id === focused) || null,
        comments: read(),
        proposals: versionState.proposals.map(
          ({ html: _html, css: _css, ...proposal }) => proposal,
        ),
        safety:
          "propose_revision creates a pending version only; only the Owner can accept it in the Viewer.",
      }),
  });
  register({
    name: "read_document",
    description:
      "Read the complete HTML and CSS for an exact immutable revision returned by get_review_context.",
    inputSchema: {
      type: "object",
      properties: { revision: { type: "string" } },
      required: ["revision"],
      additionalProperties: false,
    },
    execute: async ({ revision }) => {
      const candidates = [
        versionState.current,
        ...versionState.proposals,
        ...versionState.history,
      ];
      const version = candidates.find((item) => item.revision === revision);
      if (!version) throw new Error("Exact revision not found");
      return JSON.stringify({
        revision: version.revision,
        files: [
          { path: "document.html", encoding: "utf8", content: version.html },
          { path: "styles.css", encoding: "utf8", content: version.css },
        ],
      });
    },
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
  register({
    name: "propose_revision",
    description:
      "Submit a complete HTML/CSS candidate against the exact current revision. It becomes a pending suggestion and never updates the document until the Owner explicitly accepts it.",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string" },
        request: { type: "string", minLength: 1, maxLength: 2000 },
        key: { type: "string", minLength: 1, maxLength: 128 },
        files: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: {
            type: "object",
            properties: {
              path: { type: "string", enum: ["document.html", "styles.css"] },
              encoding: { type: "string", enum: ["utf8"] },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        commentIds: {
          type: "array",
          maxItems: 20,
          uniqueItems: true,
          items: { type: "string" },
        },
      },
      required: ["base", "request", "key", "files"],
      additionalProperties: false,
    },
    execute: async ({ base, request, key, files, commentIds = [] }) => {
      if (base !== versionState.current.revision)
        throw new Error(
          "Base revision is stale; call get_review_context and read_document again",
        );
      const fileErrors = validateCandidateFiles(files);
      if (fileErrors.length) throw new Error(fileErrors.join("; "));
      const html = files.find((file) => file.path === "document.html").content;
      const css =
        files.find((file) => file.path === "styles.css")?.content || "";
      const contentErrors = validateCandidateDocument(html, css);
      if (contentErrors.length) throw new Error(contentErrors.join("; "));
      const linked = [...new Set(commentIds)];
      const comments = read();
      if (
        linked.some(
          (commentId) =>
            !comments.some(
              (comment) =>
                comment.id === commentId && comment.status === "open",
            ),
        )
      )
        throw new Error("Every linked comment must exist and remain open");
      const revision = await revisionOf(html, css);
      if (revision === versionState.current.revision)
        throw new Error("Candidate is identical to the current version");
      const existing = versionState.proposals.find(
        (proposal) => proposal.key === key,
      );
      if (existing) {
        if (existing.base !== base || existing.revision !== revision)
          throw new Error(
            "Idempotency key already belongs to another candidate",
          );
        const { html: _html, css: _css, ...publicProposal } = existing;
        return JSON.stringify({ proposal: publicProposal, created: false });
      }
      const summary = safe(request).trim();
      if (!summary)
        throw new Error("request must describe the intended update");
      const proposal = {
        id: uid(),
        key,
        base,
        revision,
        title: "Suggested update",
        summary,
        author: "External agent",
        createdAt: now(),
        status: "pending",
        commentIds: linked,
        html,
        css,
      };
      versionState = {
        ...versionState,
        proposals: [...versionState.proposals, proposal],
      };
      persistVersions();
      activatePanel("versions");
      renderVersions();
      announce("Agent suggestion received. The current version is unchanged.");
      const { html: _html, css: _css, ...publicProposal } = proposal;
      return JSON.stringify({
        proposal: publicProposal,
        created: true,
        currentRevision: versionState.current.revision,
        next: "The Owner must review and explicitly accept or reject this suggestion in DSTAR.",
      });
    },
  });
}

if (!sample) {
  location.replace("./");
} else {
  document.title = `${sample.title} · DSTAR`;
  $("#document-title").textContent = sample.title;
  frame.addEventListener("load", attach);
  render();
  loadVersions()
    .then(registerWebMcp)
    .catch((error) => {
      announce(error.message);
      $("#document-title").textContent = "Document unavailable";
    });
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
  button.onclick = () => activatePanel(button.dataset.panel);
$("#return-current").onclick = returnToCurrent;
$("#previous-slide").onclick = () => moveSlide(-1);
$("#next-slide").onclick = () => moveSlide(1);
document.addEventListener("keydown", (event) => {
  if (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key) &&
    !event.target?.closest?.(
      'input,textarea,select,button,[contenteditable="true"]',
    )
  ) {
    event.preventDefault();
    moveSlide(["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
  }
});
window.addEventListener("pagehide", () => registrationController.abort(), {
  once: true,
});
