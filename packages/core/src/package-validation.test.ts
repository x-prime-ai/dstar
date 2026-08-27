import { describe, expect, it } from "vitest";

import annotation from "../../../spec/0.1/examples/minimal.dstar/annotations/ann_0001.json";
import change from "../../../spec/0.1/examples/minimal.dstar/changes/change_0001.json";
import genesis from "../../../spec/0.1/examples/minimal.dstar/changes/change_genesis_0001.json";
import document from "../../../spec/0.1/examples/minimal.dstar/document.json";
import manifest from "../../../spec/0.1/examples/minimal.dstar/manifest.json";
import projections from "../../../spec/0.1/examples/minimal.dstar/projections/index.json";
import sources from "../../../spec/0.1/examples/minimal.dstar/sources.json";

import { validateInMemoryPackage } from "./package-validation.js";
import type { InMemoryPackage } from "./protocol.js";

const minimalPackage = {
  manifest,
  document,
  annotations: [annotation],
  changes: [genesis, change],
  sources,
  projections,
} as unknown as InMemoryPackage;

describe("cross-object semantic validation", () => {
  it("validates the normative minimal.dstar fixture entirely in memory", () => {
    const result = validateInMemoryPackage(minimalPackage);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("reports missing motivation references without repairing data", () => {
    const invalid = {
      ...minimalPackage,
      changes: minimalPackage.changes.map((item) =>
        item.id === "change_0001"
          ? { ...item, motivatedBy: ["ann_missing"] }
          : item,
      ),
    } as InMemoryPackage;
    const result = validateInMemoryPackage(invalid);
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "REF_MISSING",
      ),
    ).toBe(true);
    expect(invalid.changes[1]?.motivatedBy).toEqual(["ann_missing"]);
  });
});
