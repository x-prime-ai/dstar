const STORAGE_KEY = "dstar:documents:v1";
const FORMATS = {
  document: { label: "Document", kicker: "NEW DOCUMENT" },
  html: { label: "Rich HTML", kicker: "RICH HTML · DRAFT" },
  slides: { label: "Slides", kicker: "01 / NEW DECK" },
  "ui-design": { label: "UI design", kicker: "UI DESIGN · DRAFT" },
};

const id = new URL(location.href).searchParams.get("id");
const canvas = document.querySelector("#document-canvas");
const title = document.querySelector("#document-title");
const body = document.querySelector("#document-body");
const saveStatus = document.querySelector("#save-status");
let active;
let saveTimer;

function documents() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function date(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function normalizedText(node) {
  return node.innerText.replaceAll("\u00a0", " ").trim();
}

function persist() {
  if (!active) return;
  active.title = normalizedText(title) || "Untitled document";
  active.body = normalizedText(body) || "Start writing here.";
  active.updatedAt = new Date().toISOString();
  const items = documents();
  const index = items.findIndex((item) => item?.id === active.id);
  if (index < 0) return;
  items[index] = active;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    document.title = `${active.title} · DSTAR`;
    document.querySelector("#updated-at").textContent = date(active.updatedAt);
    saveStatus.textContent = "Saved";
  } catch {
    saveStatus.textContent = "Could not save";
  }
}

function scheduleSave() {
  saveStatus.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function filename(value) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return `${slug || "dstar-document"}.html`;
}

function exportHtml() {
  persist();
  const mode = active.format === "slides" ? ' data-dstar-mode="slides"' : "";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(active.title)}</title>
    <style>
      :root { color: #26352e; background: #eef1ed; font-family: Georgia, serif; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 48px 20px; }
      article { width: min(840px, 100%); margin: auto; padding: 72px; background: white; box-shadow: 0 18px 60px #26352e1a; }
      .kicker { color: #698074; font: 700 11px/1.4 system-ui, sans-serif; letter-spacing: .15em; }
      h1 { margin: 20px 0 34px; color: #213b2f; font-size: clamp(46px, 8vw, 76px); font-weight: 400; line-height: 1; }
      p { color: #47574f; font-size: 18px; line-height: 1.75; white-space: pre-wrap; }
      @media (max-width: 620px) { article { padding: 40px 28px; } }
    </style>
  </head>
  <body${mode}>
    <article${active.format === "slides" ? ' data-dstar-slide="1"' : ""}>
      <p class="kicker" data-dstar-id="document-kicker">${escapeHtml(FORMATS[active.format].kicker)}</p>
      <h1 data-dstar-id="document-title">${escapeHtml(active.title)}</h1>
      <p data-dstar-id="document-body">${escapeHtml(active.body)}</p>
    </article>
  </body>
</html>
`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename(active.title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function load() {
  active = documents().find((item) => item?.id === id);
  if (!active || !Object.hasOwn(FORMATS, active.format)) {
    document.querySelector("main").hidden = true;
    document.querySelector("#download").disabled = true;
    document.querySelector("#missing").hidden = false;
    saveStatus.textContent = "Unavailable";
    return;
  }

  const format = FORMATS[active.format];
  canvas.dataset.format = active.format;
  title.textContent = active.title;
  body.textContent = active.body || active.brief || "Start writing here.";
  document.querySelector("#document-kicker").textContent = format.kicker;
  document.querySelector("#format-label").textContent =
    `${format.label} · Draft`;
  document.querySelector("#created-at").textContent = date(active.createdAt);
  document.querySelector("#updated-at").textContent = date(active.updatedAt);
  document.title = `${active.title} · DSTAR`;
}

title.addEventListener("input", scheduleSave);
body.addEventListener("input", scheduleSave);
document.querySelector("#download").addEventListener("click", exportHtml);
addEventListener("beforeunload", persist);
load();
