import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const packages = ["core", "node", "mcp-server", "render-html"];
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function dryRun(directory) {
  const result = spawnSync(
    command,
    ["--dir", directory, "pack", "--dry-run", "--json"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `pack failed for ${directory}`);
  }
  return JSON.parse(result.stdout);
}

for (const name of packages) {
  const directory = resolve(`packages/${name}`);
  const manifest = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  );
  const first = dryRun(directory);
  const second = dryRun(directory);
  const files = first.files.map((file) => file.path);
  const repeated = second.files.map((file) => file.path);
  if (JSON.stringify(files) !== JSON.stringify(repeated)) {
    throw new Error(`${manifest.name}: pack inventory is not deterministic`);
  }
  for (const required of [
    "package.json",
    "README.md",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!files.includes(required)) {
      throw new Error(`${manifest.name}: packed artifact lacks ${required}`);
    }
  }
  const forbidden = files.find(
    (path) => path.startsWith("src/") || path.includes(".test."),
  );
  if (forbidden) {
    throw new Error(`${manifest.name}: packed private file ${forbidden}`);
  }
  if (
    manifest.exports?.["."]?.import !== "./dist/index.js" ||
    manifest.exports?.["."]?.types !== "./dist/index.d.ts"
  ) {
    throw new Error(`${manifest.name}: public export map is unstable`);
  }
  process.stdout.write(
    `${manifest.name}: ${files.length} packed files checked.\n`,
  );
}
