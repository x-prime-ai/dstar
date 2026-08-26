import type { JsonValue } from "./protocol.js";

function assertScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("JSON contains an unpaired surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("JSON contains an unpaired surrogate");
    }
  }
}

export function assertJsonValue(
  value: unknown,
  seen = new Set<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertScalarString(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("JSON number must be finite");
    return;
  }
  if (typeof value !== "object")
    throw new TypeError(`Value of type ${typeof value} is not JSON`);
  if (seen.has(value)) throw new TypeError("JSON value contains a cycle");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value))
        throw new TypeError("Sparse arrays are not valid JSON values");
      assertJsonValue(value[index], seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON objects must have a plain or null prototype");
    }
    for (const [key, child] of Object.entries(value)) {
      assertScalarString(key);
      assertJsonValue(child, seen);
    }
  }
  seen.delete(value);
}
