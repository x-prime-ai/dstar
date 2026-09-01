import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(here, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "samples"), { recursive: true });
for (const file of [
  "index.html",
  "index.css",
  "index.js",
  "created.html",
  "created.css",
  "created.js",
])
  cpSync(join(root, "examples", file), join(out, file));
for (const id of ["dstar-doc", "dstar-rich", "dstar-slides", "dstar-ui-design"])
  cpSync(join(root, "examples", id), join(out, "samples", id), {
    recursive: true,
  });
for (const file of ["review.html", "review.css", "review.js"])
  cpSync(join(here, file), join(out, file));

const indexPath = join(out, "index.html");
writeFileSync(
  indexPath,
  readFileSync(indexPath, "utf8")
    .replace('href="../"', 'href="./"')
    .replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n    <link rel="icon" href="data:," />',
    ),
);

const scriptPath = join(out, "index.js");
const script = readFileSync(scriptPath, "utf8").replace(
  /async function configureSampleLinks\(\) \{[\s\S]*?\n\}\n\nfunction openDialog/,
  `async function configureSampleLinks() {
  for (const link of document.querySelectorAll("[data-sample-id]")) {
    link.href = \`review.html?id=\${encodeURIComponent(link.dataset.sampleId)}\`;
    link.title = "Open in DSTAR Viewer";
    const open = link.querySelector(".open");
    if (open) open.replaceChildren("Review ", element("b", "", "↗"));
  }
}

function openDialog`,
);
writeFileSync(scriptPath, script);
console.log(out);
