import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadMinimalFixture } from "./index.js";

describe("minimal.dstar fixture loader", () => {
  it("loads a deterministic inventory and parsed manifest", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../../..");
    const fixture = await loadMinimalFixture(repositoryRoot);
    const manifest = fixture.readJson("manifest.json");

    expect(fixture.files.map((file) => file.path)).toContain("document.json");
    expect(manifest).toMatchObject({ dstar: "0.1", document: "document.json" });
    expect(Object.isFrozen(fixture.files)).toBe(true);
  });
});
