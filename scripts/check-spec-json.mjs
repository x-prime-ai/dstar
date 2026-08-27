import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const schemaDirectory = join(repositoryRoot, "spec/0.1/schemas");
const fixtureRoot = join(repositoryRoot, "spec/0.1/examples/minimal.dstar");
// The normative schemas use valid cross-branch constraints that Ajv's optional
// strict heuristics reject (for example, `required` and `properties` inherited
// through `allOf`). Meta-schema validation remains enabled; only those
// implementation-specific lint heuristics are disabled.
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateSchema: true,
});
addFormats(ajv);

const schemaByName = new Map();
for (const filename of (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const schema = JSON.parse(
    await readFile(join(schemaDirectory, filename), "utf8"),
  );
  if (!ajv.validateSchema(schema)) {
    throw new Error(
      `Invalid JSON Schema ${filename}: ${ajv.errorsText(ajv.errors)}`,
    );
  }
  schemaByName.set(filename, schema);
  ajv.addSchema(schema);
}

const fixtureSets = [
  ["manifest.schema.json", [join(fixtureRoot, "manifest.json")]],
  ["document.schema.json", [join(fixtureRoot, "document.json")]],
  ["sources.schema.json", [join(fixtureRoot, "sources.json")]],
  ["projection.schema.json", [join(fixtureRoot, "projections/index.json")]],
  [
    "annotation.schema.json",
    (await readdir(join(fixtureRoot, "annotations"))).map((name) =>
      join(fixtureRoot, "annotations", name),
    ),
  ],
  [
    "change.schema.json",
    (await readdir(join(fixtureRoot, "changes"))).map((name) =>
      join(fixtureRoot, "changes", name),
    ),
  ],
];

const failures = [];
for (const [schemaName, fixturePaths] of fixtureSets) {
  const schema = schemaByName.get(schemaName);
  const validate = ajv.getSchema(schema.$id);
  for (const fixturePath of fixturePaths) {
    try {
      const value = JSON.parse(await readFile(fixturePath, "utf8"));
      if (!validate(value)) {
        failures.push(
          `${relative(repositoryRoot, fixturePath)}: ${ajv.errorsText(validate.errors, { separator: "; " })}`,
        );
      }
    } catch (error) {
      failures.push(
        `${relative(repositoryRoot, fixturePath)}: ${String(error)}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Specification fixture validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const count = fixtureSets.reduce(
    (sum, [, fixturePaths]) => sum + fixturePaths.length,
    0,
  );
  console.log(
    `Validated ${schemaByName.size} schemas and ${count} JSON fixtures.`,
  );
}
