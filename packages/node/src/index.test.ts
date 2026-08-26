import { describe, expect, it } from "vitest";

import { describeNodeRuntimeBoundary } from "./index.js";

describe("node runtime boundary", () => {
  it("is explicit about Node filesystem access", () => {
    expect(describeNodeRuntimeBoundary()).toEqual({
      platform: "node",
      filesystemAccess: true,
    });
  });
});
