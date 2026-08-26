import { describe, expect, it } from "vitest";

import {
  canonicalize,
  projectionRevision,
  revisionOf,
  sha256Hex,
} from "./revisions.js";

describe("RFC 8785 canonicalization and SHA-256", () => {
  it("matches the RFC 8785 serialization sample", () => {
    const value = {
      numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
      string: '€$\u000f\nA\'B"\\"/',
      literals: [null, true, false],
    };

    expect(canonicalize(value)).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\"/"}`,
    );
  });

  it("matches published SHA-256 vectors", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("makes object member order irrelevant but retains stable IDs", () => {
    expect(revisionOf({ b: 2, a: 1 })).toBe(revisionOf({ a: 1, b: 2 }));
    expect(revisionOf({ id: "node_a", text: "same" })).not.toBe(
      revisionOf({ id: "node_b", text: "same" }),
    );
  });

  it("sorts property names by UTF-16 code units as required by JCS", () => {
    const value = { "€": 1, "\r": 1, דּ: 1, "1": 1, "😀": 1, "\u0080": 1, ö: 1 };
    // Compare serialized bytes: parsing again would make ECMAScript enumerate
    // the integer-like key "1" before the other keys regardless of source order.
    expect(canonicalize(value)).toBe(
      '{"\\r":1,"1":1,"\u0080":1,"ö":1,"€":1,"😀":1,"דּ":1}',
    );
  });

  it("hashes projection raw bytes independently of canonical JSON", () => {
    expect(projectionRevision(new TextEncoder().encode("{}\n"))).not.toBe(
      revisionOf({}),
    );
  });
});
