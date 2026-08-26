import { describe, expect, it } from "vitest";

import { captureNodeObject } from "./selection.js";

describe("selection capture", () => {
  it("creates a portable object selector without DOM state", () => {
    expect(captureNodeObject("node_test", "sha256:test")).toEqual({
      target: {
        source: "document",
        revision: "sha256:test",
        selector: { type: "NodeSelector", node: "node_test" },
      },
      exact: "Node node_test",
      sourceLabel: "Canonical document object",
    });
  });
});
