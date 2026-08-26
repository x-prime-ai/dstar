import { describe, expect, it } from "vitest";

import {
  buildAnnotation,
  buildDelegation,
  buildGenesisProposal,
} from "./builders.js";
import type { DstarActor, DstarDocument } from "./protocol.js";

const human: DstarActor = { type: "human", id: "human" };
const agent: DstarActor = { type: "agent", id: "agent" };
const service: DstarActor = { type: "service", id: "service" };
const createdAt = "2026-01-01T00:00:00.000Z";

describe("in-memory protocol builders", () => {
  it("creates an open comment without inferring a delegation", () => {
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
    expect("delegation" in annotation).toBe(false);
    expect(Object.isFrozen(annotation)).toBe(true);
  });

  it("creates delegation separately with human creator and agent assignee", () => {
    const delegation = buildDelegation({
      id: "delegation",
      annotationId: "ann",
      assignee: agent,
      createdBy: human,
      createdAt,
    });
    expect(delegation.status).toBe("queued");
    expect(() =>
      buildDelegation({
        id: "invalid",
        annotationId: "ann",
        assignee: service,
        createdBy: human,
        createdAt,
      }),
    ).toThrowError("assignee must be an agent actor");
  });

  it("never lets a human be serialized as a canonical author", () => {
    const document: DstarDocument = {
      id: "doc",
      type: "document",
      children: [],
    };
    expect(() =>
      buildGenesisProposal({
        id: "genesis",
        operationId: "create",
        idempotencyKey: "key",
        author: human,
        requestActor: human,
        requestBody: "Create",
        createdAt,
        document,
      }),
    ).toThrowError("author must be an agent actor");
  });
});
