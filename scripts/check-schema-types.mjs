import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { renderSchemaTypes } from "./lib/schema-types.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const outputDirectory = join(
  repositoryRoot,
  "packages/core/src/schema/generated",
);
const expected = await renderSchemaTypes(repositoryRoot);
const actualFiles = (await readdir(outputDirectory))
  .filter((name) => name.endsWith(".ts"))
  .sort();
const expectedFiles = [...expected.keys()].sort();
const problems = [];

if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  problems.push(
    `generated file set differs: expected ${expectedFiles.join(", ")}`,
  );
}

for (const [filename, expectedContents] of expected) {
  try {
    const actualContents = await readFile(
      join(outputDirectory, filename),
      "utf8",
    );
    if (actualContents !== expectedContents) {
      problems.push(`${filename} is stale`);
    }
  } catch {
    problems.push(`${filename} is missing`);
  }
}

if (problems.length > 0) {
  console.error("Generated schema types are out of date:");
  for (const problem of problems) console.error(`- ${problem}`);
  console.error("Run `pnpm generate:schema-types` and commit the result.");
  process.exitCode = 1;
} else {
  console.log(`Schema type drift check passed for ${expected.size} schemas.`);
}
