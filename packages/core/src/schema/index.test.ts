import { describe, expect, it } from "vitest";

import { SCHEMA_IDS } from "./index.js";

describe("schema registry", () => {
  it("publishes each normative 0.1 schema ID", () => {
    expect(Object.keys(SCHEMA_IDS).sort()).toEqual([
      "annotation",
      "change",
      "delegation",
      "document",
      "manifest",
      "projection",
      "sources",
    ]);
  });
});
