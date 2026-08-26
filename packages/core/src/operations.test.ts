import { describe, expect, it } from "vitest";

import { nodeTextStream } from "./indexes.js";
import { semanticDiff, simulateOperations } from "./operations.js";
import type { DstarDocument, DstarUpdateOperation } from "./protocol.js";
import { nodeRevision } from "./revisions.js";

function baseDocument(): DstarDocument {
  return {
    id: "doc",
    type: "document",
    children: [
      {
        id: "heading",
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "alpha" }],
        "x-note": "keep",
      },
      {
        id: "p2",
        type: "paragraph",
        content: [{ type: "text", text: "beta" }],
      },
    ],
  };
}

function find(document: DstarDocument, id: string) {
  const stack = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.id === id) return node;
    stack.push(...(node?.children ?? []));
  }
  throw new Error(`Missing ${id}`);
}

function apply(
  document: DstarDocument,
  operation: DstarUpdateOperation,
): DstarDocument {
  const result = simulateOperations(document, [operation]);
  expect(result.diagnostics).toEqual([]);
  expect(result.applicable).toBe(true);
  return result.result!;
}

describe("six ordered update operations", () => {
  it("applies replace_text using Unicode code-point ranges", () => {
    const document = baseDocument();
    const p1 = find(document, "p1");
    const result = apply(document, {
      id: "op_replace_text",
      op: "replace_text",
      target: { node: "p1" },
      precondition: { nodeRevision: nodeRevision(p1), expectedText: "alpha" },
      range: { start: 0, end: 5, unit: "unicode-code-point" },
      value: "😀",
    });
    expect(nodeTextStream(find(result, "p1"))).toBe("😀");
    expect(find(result, "p1")["x-note"]).toBe("keep");
  });

  it("applies replace_inline without implicit mark normalization", () => {
    const document = baseDocument();
    const result = apply(document, {
      id: "op_replace_inline",
      op: "replace_inline",
      target: { node: "p2" },
      precondition: { nodeRevision: nodeRevision(find(document, "p2")) },
      value: [
        {
          type: "text",
          text: "linked",
          marks: [{ type: "link", attrs: { href: "https://example.test" } }],
        },
      ],
    });
    expect(find(result, "p2").content?.[0]?.marks?.[0]?.type).toBe("link");
  });

  it("applies insert_node and rejects duplicate subtree IDs", () => {
    const document = baseDocument();
    const inserted = apply(document, {
      id: "op_insert",
      op: "insert_node",
      destination: { parent: "doc", after: "p1" },
      destinationPrecondition: { nodeRevision: nodeRevision(document) },
      value: {
        id: "p3",
        type: "paragraph",
        content: [{ type: "text", text: "inserted" }],
      },
    });
    expect(inserted.children?.map((node) => node.id)).toEqual([
      "heading",
      "p1",
      "p3",
      "p2",
    ]);

    const duplicate = simulateOperations(document, [
      {
        id: "op_duplicate",
        op: "insert_node",
        destination: { parent: "doc" },
        destinationPrecondition: { nodeRevision: nodeRevision(document) },
        value: {
          id: "p1",
          type: "paragraph",
          content: [{ type: "text", text: "copy" }],
        },
      },
    ]);
    expect(duplicate.applicable).toBe(false);
  });

  it("applies delete_node with target and origin protection", () => {
    const document = baseDocument();
    const result = apply(document, {
      id: "op_delete",
      op: "delete_node",
      target: { node: "p2" },
      precondition: { nodeRevision: nodeRevision(find(document, "p2")) },
      origin: { parent: "doc" },
      originPrecondition: { nodeRevision: nodeRevision(document) },
    });
    expect(result.children?.map((node) => node.id)).toEqual(["heading", "p1"]);
  });

  it("applies same-parent move indexes after removal", () => {
    const document = baseDocument();
    const result = apply(document, {
      id: "op_move",
      op: "move_node",
      target: { node: "heading" },
      precondition: { nodeRevision: nodeRevision(find(document, "heading")) },
      origin: { parent: "doc" },
      originPrecondition: { nodeRevision: nodeRevision(document) },
      destination: { parent: "doc", index: 2 },
      destinationPrecondition: { nodeRevision: nodeRevision(document) },
    });
    expect(result.children?.map((node) => node.id)).toEqual([
      "p1",
      "p2",
      "heading",
    ]);
  });

  it("applies set_attrs as replacement and null removes attrs", () => {
    const document = baseDocument();
    const changed = apply(document, {
      id: "op_attrs",
      op: "set_attrs",
      target: { node: "heading" },
      precondition: { nodeRevision: nodeRevision(find(document, "heading")) },
      value: { level: 2 },
    });
    expect(find(changed, "heading").attrs).toEqual({ level: 2 });

    const invalidRemoval = simulateOperations(changed, [
      {
        id: "op_remove_attrs",
        op: "set_attrs",
        target: { node: "heading" },
        precondition: { nodeRevision: nodeRevision(find(changed, "heading")) },
        value: null,
      },
    ]);
    expect(invalidRemoval.applicable).toBe(false);
  });

  it("evaluates later preconditions against earlier operation results atomically", () => {
    const document = baseDocument();
    const first: DstarUpdateOperation = {
      id: "op_first",
      op: "replace_text",
      target: { node: "p1" },
      precondition: {
        nodeRevision: nodeRevision(find(document, "p1")),
        expectedText: "alpha",
      },
      range: { start: 0, end: 5, unit: "unicode-code-point" },
      value: "changed",
    };
    const intermediate = apply(document, first);
    const second: DstarUpdateOperation = {
      id: "op_second",
      op: "set_attrs",
      target: { node: "p1" },
      precondition: { nodeRevision: nodeRevision(find(intermediate, "p1")) },
      value: { role: "lead" },
    };
    const combined = simulateOperations(document, [first, second]);
    expect(combined.applicable).toBe(true);
    expect(find(combined.result!, "p1").attrs).toEqual({ role: "lead" });

    const stale = simulateOperations(document, [
      first,
      { ...second, precondition: { nodeRevision: "sha256:" + "0".repeat(64) } },
    ]);
    expect(stale.applicable).toBe(false);
    expect(stale.result).toBeUndefined();
    expect(document).toEqual(baseDocument());
  });

  it("reports stable-ID semantic differences", () => {
    const before = baseDocument();
    const after = {
      ...baseDocument(),
      children: [baseDocument().children![1]!, baseDocument().children![0]!],
    };
    expect(
      semanticDiff(before, after).movedNodes.map((move) => move.nodeId),
    ).toContain("p1");
  });

  it("preserves unknown declared-profile content losslessly", () => {
    const document = baseDocument();
    document.children!.push({
      id: "custom",
      type: "urn:example:profile:callout",
      attrs: { tone: "notice", nested: { exact: true } },
      content: [
        { type: "urn:example:profile:inline", attrs: { payload: [1, 2, 3] } },
      ],
      "x-extension": { retained: "yes" },
    });
    const operation: DstarUpdateOperation = {
      id: "op_preserve",
      op: "replace_text",
      target: { node: "p1" },
      precondition: {
        nodeRevision: nodeRevision(find(document, "p1")),
        expectedText: "alpha",
      },
      range: { start: 0, end: 5, unit: "unicode-code-point" },
      value: "updated",
    };
    const result = simulateOperations(
      document,
      [operation],
      ["dstar:base", "urn:example:profile"],
    );
    expect(result.applicable).toBe(true);
    expect(find(result.result!, "custom")).toEqual(find(document, "custom"));
  });
});
