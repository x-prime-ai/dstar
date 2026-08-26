import { describe, expect, it } from "vitest";

import { DocumentIndex } from "./indexes.js";
import type { DstarDocument } from "./protocol.js";
import {
  canonicalRangeText,
  codePointLength,
  codePointOffsetToUtf16,
  resolveNodeSelector,
  utf16OffsetToCodePoint,
} from "./selectors.js";

const document: DstarDocument = {
  id: "doc",
  type: "document",
  children: [
    {
      id: "p1",
      type: "paragraph",
      content: [{ type: "text", text: "😀 alpha alpha" }],
    },
    { id: "p2", type: "paragraph", content: [{ type: "text", text: "omega" }] },
  ],
};

describe("Unicode selectors", () => {
  it("converts UTF-16 and code-point offsets without splitting surrogate pairs", () => {
    expect(codePointLength("a😀b")).toBe(3);
    expect(codePointOffsetToUtf16("a😀b", 2)).toBe(3);
    expect(utf16OffsetToCodePoint("a😀b", 3)).toBe(2);
    expect(() => utf16OffsetToCodePoint("a😀b", 2)).toThrowError(RangeError);
  });

  it("exposes immutable document indexes", () => {
    const index = new DocumentIndex(document);
    expect("set" in index.nodes).toBe(false);
    expect(Object.isFrozen(index.get("p1"))).toBe(true);
  });

  it("recovers a unique quote with context and leaves ambiguity visible", () => {
    const index = new DocumentIndex(document);
    const recovered = resolveNodeSelector(index, {
      type: "NodeSelector",
      node: "p1",
      refinedBy: [
        {
          type: "TextPositionSelector",
          start: 0,
          end: 5,
          unit: "unicode-code-point",
        },
        { type: "TextQuoteSelector", exact: "alpha", prefix: "😀 " },
      ],
    });
    const ambiguous = resolveNodeSelector(index, {
      type: "NodeSelector",
      node: "p1",
      refinedBy: [{ type: "TextQuoteSelector", exact: "alpha" }],
    });

    expect(recovered.state).toBe("recovered");
    expect(ambiguous.state).toBe("ambiguous");
  });

  it("constructs LF-normalized cross-node canonical quotation", () => {
    const index = new DocumentIndex(document);
    expect(
      canonicalRangeText(index, {
        type: "NodeRangeSelector",
        start: { node: "p1", offset: 8 },
        end: { node: "p2", offset: 5 },
        unit: "unicode-code-point",
        exact: "alpha\nomega",
      }),
    ).toBe("alpha\nomega");
  });
});
