const DOCUMENTS_KEY = "dstar:agent-documents:v1";
const FORMATS = {
  document: "Document",
  html: "Rich HTML",
  slides: "Slides",
  "ui-design": "UI design",
};

const id = new URL(location.href).searchParams.get("id");
const preview = document.querySelector("#document-preview");
let active;

function documents() {
  try {
    const value = JSON.parse(localStorage.getItem(DOCUMENTS_KEY) ?? "[]");
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

function previewHtml(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  parsed.head.prepend(policy);
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
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

function download() {
  if (!active) return;
  const url = URL.createObjectURL(
    new Blob([active.html], { type: "text/html" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename(active.title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function load() {
  active = documents().find(
    (item) =>
      item?.id === id &&
      typeof item.title === "string" &&
      typeof item.html === "string" &&
      Object.hasOwn(FORMATS, item.format),
  );
  if (!active) {
    document.querySelector("main").hidden = true;
    document.querySelector("#download").disabled = true;
    document.querySelector("#missing").hidden = false;
    return;
  }

  document.title = `${active.title} · DSTAR`;
  document.querySelector("#format-label").textContent =
    `${FORMATS[active.format]} · Agent created`;
  document.querySelector("#created-at").textContent = date(active.createdAt);
  document.querySelector("#document-format").textContent =
    FORMATS[active.format];
  preview.srcdoc = previewHtml(active.html);
}

document.querySelector("#download").addEventListener("click", download);
load();
