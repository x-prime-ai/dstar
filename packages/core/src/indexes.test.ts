import { describe, expect, it } from "vitest";

import { PackageIndex } from "./indexes.js";
import type { InMemoryPackage } from "./protocol.js";

describe("protocol identifier scopes", () => {
  it("allows the same reply ID in different annotation-thread scopes", () => {
    const annotation = (id: string) => ({
      id,
      type: "comment",
      purpose: "discussion",
      scope: "canonical",
      target: {
        source: "document",
        revision: "sha256:" + "0".repeat(64),
        selector: { type: "NodeSelector", node: "p" },
      },
      body: "Body",
      author: { type: "human", id: "human" },
      replies: [
        {
          id: "reply_local",
          body: "Reply",
          author: { type: "human", id: "human" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const pkg = {
      manifest: {},
      document: {
        id: "doc",
        type: "document",
        children: [
          {
            id: "p",
            type: "paragraph",
            content: [{ type: "text", text: "Text" }],
          },
        ],
      },
      annotations: [annotation("ann_1"), annotation("ann_2")],
      changes: [],
    } as unknown as InMemoryPackage;

    const index = new PackageIndex(pkg);
    expect(index.getReply("ann_1", "reply_local")).toBeDefined();
    expect(index.getReply("ann_2", "reply_local")).toBeDefined();
  });
});
