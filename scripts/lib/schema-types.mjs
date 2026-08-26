import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { compile } from "json-schema-to-typescript";

const bannerComment = `/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run \`pnpm generate:schema-types\`.
 */`;

export async function renderSchemaTypes(repositoryRoot) {
  const schemaDirectory = join(repositoryRoot, "spec/0.1/schemas");
  const schemaFiles = (await readdir(schemaDirectory))
    .filter((entry) => entry.endsWith(".schema.json"))
    .sort();

  const rendered = new Map();
  const schemaDocuments = {};
  for (const schemaFile of schemaFiles) {
    const source = await readFile(join(schemaDirectory, schemaFile), "utf8");
    const schema = JSON.parse(source);
    schemaDocuments[schemaFile.replace(/\.schema\.json$/, "")] = schema;
    const outputName = schemaFile.replace(/\.schema\.json$/, ".ts");
    const types = await compile(schema, basename(schemaFile, ".schema.json"), {
      bannerComment,
      cwd: schemaDirectory,
      format: false,
      style: {
        bracketSpacing: true,
        printWidth: 100,
        semi: true,
        singleQuote: false,
        tabWidth: 2,
        trailingComma: "all",
        useTabs: false,
      },
      unreachableDefinitions: true,
    });
    rendered.set(outputName, types);
  }
  rendered.set(
    "schema-documents.ts",
    `${bannerComment}\n\nexport const SCHEMA_DOCUMENTS = ${JSON.stringify(schemaDocuments, null, 2)} as const;\n`,
  );
  return rendered;
}

export async function writeSchemaTypes(repositoryRoot, outputDirectory) {
  const rendered = await renderSchemaTypes(repositoryRoot);
  await Promise.all(
    [...rendered].map(([filename, contents]) =>
      writeFile(join(outputDirectory, filename), contents, "utf8"),
    ),
  );
  return rendered;
}
