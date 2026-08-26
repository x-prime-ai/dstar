import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import {
  parseIJson,
  validatePackagePath,
} from "../packages/core/dist/index.js";
import {
  assertSafeGeneratedHtml,
  safeLink,
} from "../packages/render-html/dist/index.js";

const corpus = JSON.parse(
  await readFile(
    new URL("../tests/security/corpus.json", import.meta.url),
    "utf8",
  ),
);
if (corpus.format !== "dstar-security-corpus/0.1") {
  throw new Error("Unsupported security corpus format");
}

let count = 0;
for (const entry of corpus.ijson) {
  let code;
  try {
    parseIJson(entry.input, entry.limits);
  } catch (error) {
    code = error?.code;
  }
  if (code !== entry.error) {
    throw new Error(`${entry.id}: expected ${entry.error}, received ${code}`);
  }
  count += 1;
}
for (const entry of corpus.paths) {
  const result = validatePackagePath(entry.input);
  if (result.valid !== entry.valid || result.code !== entry.code) {
    throw new Error(`path ${entry.input}: unexpected validation result`);
  }
  count += 1;
}
for (const entry of corpus.links) {
  if ((safeLink(entry.input) ?? null) !== entry.safe) {
    throw new Error(`link ${entry.input}: unexpected safe-link result`);
  }
  count += 1;
}
for (const entry of corpus.generatedHtml) {
  let safe = true;
  try {
    assertSafeGeneratedHtml(entry.input);
  } catch {
    safe = false;
  }
  if (safe !== entry.safe) {
    throw new Error(`HTML case did not produce safe=${entry.safe}`);
  }
  count += 1;
}
process.stdout.write(`Security corpus: ${count} cases passed.\n`);
