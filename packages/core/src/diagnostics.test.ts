import { describe, expect, it } from "vitest";

import { createDiagnostic, DIAGNOSTIC_REGISTRY } from "./diagnostics.js";

describe("diagnostic registry", () => {
  it("creates diagnostics from stable registry defaults", () => {
    expect(createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN")).toEqual({
      code: "AUTH_DECISION_ACTOR_NOT_HUMAN",
      family: "AUTH",
      severity: "error",
      summary: DIAGNOSTIC_REGISTRY.AUTH_DECISION_ACTOR_NOT_HUMAN.summary,
    });
  });

  it("allows bounded structured context without changing the code", () => {
    const diagnostic = createDiagnostic("REF_MISSING", {
      location: { objectId: "ann_0001", pointer: "/target" },
      details: { referencedId: "node_missing" },
    });

    expect(diagnostic.location?.objectId).toBe("ann_0001");
    expect(diagnostic.details).toEqual({ referencedId: "node_missing" });
  });
});
