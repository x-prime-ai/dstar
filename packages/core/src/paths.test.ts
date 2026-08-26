import { describe, expect, it } from "vitest";

import { validatePackagePath } from "./paths.js";

describe("package path grammar", () => {
  it.each([
    "document.json",
    "annotations/ann_1.json",
    "assets/sources/source_1/report.pdf",
  ])("accepts %s", (path) => {
    expect(validatePackagePath(path)).toEqual({ valid: true });
  });

  it.each([
    ["", "empty"],
    ["/absolute", "absolute"],
    ["a//b", "empty-segment"],
    ["a/../b", "dot-segment"],
    ["a\\b", "backslash"],
    ["C:/drive", "colon"],
    ["https://example.test", "colon"],
  ])("rejects %s", (path, code) => {
    expect(validatePackagePath(path)).toEqual({ valid: false, code });
  });
});
