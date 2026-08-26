import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
  );
  return nested.flat();
}

const failures = [];
const markdownFiles = (await walk(repositoryRoot)).filter(
  (path) => extname(path) === ".md",
);
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;

for (const markdownFile of markdownFiles) {
  const contents = await readFile(markdownFile, "utf8");
  for (const match of contents.matchAll(markdownLink)) {
    const rawTarget = match[1]?.trim();
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z\d+.-]*:/i.test(rawTarget)
    )
      continue;
    const unwrapped =
      rawTarget.startsWith("<") && rawTarget.endsWith(">")
        ? rawTarget.slice(1, -1)
        : rawTarget;
    const pathPart = decodeURIComponent(unwrapped.split("#", 1)[0] ?? "");
    if (!pathPart) continue;
    const target = resolve(dirname(markdownFile), pathPart);
    try {
      await access(target, constants.F_OK);
    } catch {
      failures.push(
        `${relative(repositoryRoot, markdownFile)} -> ${rawTarget}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Broken local Markdown links:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated local links in ${markdownFiles.length} Markdown files.`,
  );
}
