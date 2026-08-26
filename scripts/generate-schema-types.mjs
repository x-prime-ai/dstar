import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { writeSchemaTypes } from "./lib/schema-types.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const outputDirectory = join(
  repositoryRoot,
  "packages/core/src/schema/generated",
);

await mkdir(outputDirectory, { recursive: true });
const rendered = await writeSchemaTypes(repositoryRoot, outputDirectory);
console.log(`Generated ${rendered.size} schema type modules.`);
