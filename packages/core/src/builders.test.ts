import { describe, expect, it } from "vitest";

import { buildAnnotation, buildGenesisProposal } from "./builders.js";
import type { DstarActor, DstarDocument } from "./protocol.js";

const human: DstarActor = { type: "human", id: "human" };
const service: DstarActor = { type: "service", id: "service" };
const createdAt = "2026-01-01T00:00:00.000Z";

describe("in-memory protocol builders", () => {
  it("creates an open comment without requiring assignment", () => {
    const annotation = buildAnnotation({
      id: "ann",
      purpose: "change-request",
      scope: "canonical",
      target: {
        source: "document",
        revision: "sha256:" + "0".repeat(64),
        selector: { type: "NodeSelector", node: "p" },
      },
      body: "Please revisit this.",
      author: human,
      createdAt,
    });
    expect(annotation.status).toBe("open");
    expect(annotation.assignee).toBeUndefined();
    expect(Object.isFrozen(annotation)).toBe(true);
  });

  it("allows only a human annotation assignee", () => {
    expect(() =>
      buildAnnotation({
        id: "ann",
        purpose: "discussion",
        scope: "canonical",
        target: {
          source: "document",
          revision: "sha256:" + "0".repeat(64),
          selector: { type: "NodeSelector", node: "p" },
        },
        body: "Discuss",
        author: human,
        assignee: service,
        createdAt,
      }),
    ).toThrowError("assignee must be a human actor");
  });

  it("builds a caller-independent proposal with a human author", () => {
    const document: DstarDocument = {
      id: "doc",
      type: "document",
      children: [],
    };
    expect(
      buildGenesisProposal({
        id: "genesis",
        operationId: "create",
        idempotencyKey: "key",
        author: human,
        requestActor: human,
        requestBody: "Create",
        createdAt,
        document,
      }).author,
    ).toEqual(human);
  });
});
