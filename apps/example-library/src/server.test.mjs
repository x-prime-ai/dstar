import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { startExampleLibrary } from "./server.mjs";

let service;
afterEach(async () => {
  await service?.close();
  service = undefined;
});

it("serves the library and opens every sample through an isolated Viewer", async () => {
  service = await startExampleLibrary({
    port: 0,
    runtimeRoot: mkdtempSync(join(tmpdir(), "dstar-example-library-test-")),
    examplesRoot: resolve(import.meta.dirname, "../../../examples"),
  });

  const response = await fetch(`${service.origin}/api/documents`);
  expect(response.status).toBe(200);
  const documents = await response.json();
  expect(documents).toHaveLength(4);
  expect(documents.map((document) => document.id)).toEqual([
    "dstar-doc",
    "dstar-rich",
    "dstar-slides",
    "dstar-ui-design",
  ]);
  for (const document of documents) {
    const url = new URL(document.viewerUrl);
    expect(url.hash).toHaveLength(65);
    url.hash = "";
    const viewer = await fetch(url);
    expect(viewer.status).toBe(200);
    expect(await viewer.text()).toContain('id="selection-comment"');
  }

  const library = await (await fetch(service.url)).text();
  expect(library).toContain("Documents");
  expect(library).toContain('data-sample-id="dstar-doc"');
  expect(library).toContain('src="index.js?v=viewer-links"');
  expect(
    await (await fetch(`${service.origin}/examples/index.js`)).text(),
  ).toContain("/api/documents");
  expect((await fetch(`${service.origin}/../package.json`)).status).toBe(404);
});
