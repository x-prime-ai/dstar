import { describe, expect, it } from "vitest";

import { validateStructure } from "./structural-validation.js";

describe("generated structural validators", () => {
  it("accepts a minimal base document", () => {
    const result = validateStructure("document", {
      id: "doc",
      type: "document",
      children: [
        {
          id: "p1",
          type: "paragraph",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns stable diagnostics for invalid structure", () => {
    const result = validateStructure("manifest", { dstar: "0.1" });
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
      family: "SCHEMA",
    });
  });
});
