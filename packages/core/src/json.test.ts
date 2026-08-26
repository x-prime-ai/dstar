import { describe, expect, it } from "vitest";

import { parseIJson } from "./json.js";
import type { IJsonParseError } from "./json.js";

describe("I-JSON parser", () => {
  it("parses and deeply freezes valid values", () => {
    const parsed = parseIJson('{"value":["😀",1,true,null]}');

    expect(parsed.value).toEqual({ value: ["😀", 1, true, null] });
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen((parsed.value as { value: unknown }).value)).toBe(
      true,
    );
  });

  it("rejects duplicate keys before JSON.parse can erase them", () => {
    expect(() => parseIJson('{"same":1,"same":2}')).toThrowError(
      expect.objectContaining<IJsonParseError>({ code: "JSON_DUPLICATE_KEY" }),
    );
  });

  it.each([
    ["BOM", "\ufeff{}", "JSON_BOM_FORBIDDEN"],
    ["unpaired surrogate", '"\\ud800"', "JSON_INVALID_UNICODE"],
    ["unsafe integer", "9007199254740992", "JSON_INVALID_NUMBER"],
    ["overflow", "1e400", "JSON_INVALID_NUMBER"],
    ["trailing content", "{} true", "JSON_TRAILING_CONTENT"],
  ])("rejects %s", (_label, input, code) => {
    expect(() => parseIJson(input)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("enforces configured resource limits", () => {
    expect(() => parseIJson("[[[]]]", { maxDepth: 2 })).toThrowError(
      expect.objectContaining({ code: "JSON_DEPTH_EXCEEDED" }),
    );
    expect(() => parseIJson("[1,2]", { maxArrayLength: 1 })).toThrowError(
      expect.objectContaining({ code: "JSON_LIMIT_EXCEEDED" }),
    );
  });
});
