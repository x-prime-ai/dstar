import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const coreRoot = join(repositoryRoot, "packages/core");
const sourceRoot = join(coreRoot, "src");
const forbiddenPackages = new Set([
  "@dstar/node",
  "@modelcontextprotocol/sdk",
  "react",
  "react-dom",
]);
const nodeBuiltins = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "stream",
  "timers",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

const packageJson = JSON.parse(
  await readFile(join(coreRoot, "package.json"), "utf8"),
);
const dependencies = Object.keys(packageJson.dependencies ?? {});
const violations = dependencies
  .filter(
    (dependency) =>
      dependency === "@dstar/node" || forbiddenPackages.has(dependency),
  )
  .map(
    (dependency) =>
      `packages/core/package.json depends on forbidden package ${dependency}`,
  );

const importPattern =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
for (const file of await walk(sourceRoot)) {
  if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(file))) continue;
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier) continue;
    const bareName = specifier.startsWith("node:")
      ? specifier.slice(5).split("/")[0]
      : specifier.split("/")[0];
    if (
      specifier.startsWith("node:") ||
      nodeBuiltins.has(bareName) ||
      [...forbiddenPackages].some(
        (forbidden) =>
          specifier === forbidden || specifier.startsWith(`${forbidden}/`),
      )
    ) {
      violations.push(
        `${relative(repositoryRoot, file)} imports forbidden module ${specifier}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("SDK boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    "SDK dependency boundary check passed: @dstar/core is browser-safe and independent.",
  );
}
