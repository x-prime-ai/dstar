const STORAGE_KEY = "dstar:documents:v1";
const FORMATS = {
  document: "DOCUMENT",
  html: "RICH HTML",
  slides: "SLIDES",
  "ui-design": "UI DESIGN",
};

const dialog = document.querySelector("#create-dialog");
const form = document.querySelector("#create-form");
const titleInput = document.querySelector("#document-title");
const status = document.querySelector("#create-status");
const ownSection = document.querySelector("#your-documents");
const ownList = document.querySelector("#your-document-list");
const count = document.querySelector("#document-count");

function documents() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        Object.hasOwn(FORMATS, item.format) &&
        typeof item.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function documentRow(item, index) {
  const link = element("a", "document-row doc-created");
  link.href = `created.html?id=${encodeURIComponent(item.id)}`;

  link.append(element("span", "number", String(index + 1).padStart(2, "0")));
  const preview = element("span", "preview");
  preview.setAttribute("aria-hidden", "true");
  link.append(preview);

  const copy = element("span", "document-copy");
  copy.append(
    element("span", "document-type", `${FORMATS[item.format]} · DRAFT`),
  );
  copy.append(element("strong", "", item.title));
  copy.append(
    element(
      "span",
      "description",
      item.brief || "A new document ready for its first draft.",
    ),
  );
  link.append(copy);

  const features = element("span", "features");
  features.append(element("span", "", "Draft"));
  features.append(element("span", "", "Browser local"));
  link.append(features);

  const open = element("span", "open", "Open ");
  open.append(element("b", "", "↗"));
  link.append(open);
  return link;
}

function render() {
  const items = documents().sort((a, b) =>
    String(b.updatedAt ?? b.createdAt).localeCompare(
      String(a.updatedAt ?? a.createdAt),
    ),
  );
  ownList.replaceChildren(
    ...items.map((item, index) => documentRow(item, index)),
  );
  ownSection.hidden = items.length === 0;
  const total = items.length + 4;
  count.textContent = `${total} document${total === 1 ? "" : "s"}`;
}

function openDialog() {
  form.reset();
  status.textContent =
    "The draft is saved in this browser and can be downloaded as HTML.";
  dialog.showModal();
  requestAnimationFrame(() => titleInput.focus());
}

function closeDialog() {
  dialog.close();
}

document.querySelector("#new-document").addEventListener("click", openDialog);
document.querySelector("#close-dialog").addEventListener("click", closeDialog);
document.querySelector("#cancel-create").addEventListener("click", closeDialog);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const title = String(data.get("title") ?? "").trim();
  const format = String(data.get("format") ?? "document");
  const brief = String(data.get("brief") ?? "").trim();
  if (!title || !Object.hasOwn(FORMATS, format)) return;

  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    title,
    format,
    brief,
    body: brief || "Start writing here.",
    createdAt: now,
    updatedAt: now,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item, ...documents()]));
  } catch {
    status.textContent = "This browser could not save the new document.";
    return;
  }
  location.assign(`created.html?id=${encodeURIComponent(item.id)}`);
});

addEventListener("pageshow", render);
render();
