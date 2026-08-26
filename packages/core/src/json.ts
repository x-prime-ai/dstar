import type { JsonValue } from "./protocol.js";

export interface IJsonLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxValues: number;
  readonly maxArrayLength: number;
  readonly maxObjectProperties: number;
  readonly maxStringCodePoints: number;
}

export const DEFAULT_IJSON_LIMITS: IJsonLimits = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 128,
  maxValues: 1_000_000,
  maxArrayLength: 1_000_000,
  maxObjectProperties: 1_000_000,
  maxStringCodePoints: 8 * 1024 * 1024,
});

export type IJsonErrorCode =
  | "JSON_BOM_FORBIDDEN"
  | "JSON_DEPTH_EXCEEDED"
  | "JSON_DUPLICATE_KEY"
  | "JSON_INVALID_NUMBER"
  | "JSON_INVALID_SYNTAX"
  | "JSON_INVALID_UNICODE"
  | "JSON_LIMIT_EXCEEDED"
  | "JSON_TRAILING_CONTENT";

export class IJsonParseError extends SyntaxError {
  readonly code: IJsonErrorCode;
  readonly offset: number;

  constructor(code: IJsonErrorCode, message: string, offset: number) {
    super(`${message} at UTF-16 offset ${offset}`);
    this.name = "IJsonParseError";
    this.code = code;
    this.offset = offset;
  }
}

export interface ParsedIJson<T extends JsonValue = JsonValue> {
  readonly value: T;
  readonly sourceText: string;
  readonly utf8Bytes: number;
}

function mergeLimits(overrides: Partial<IJsonLimits>): IJsonLimits {
  return { ...DEFAULT_IJSON_LIMITS, ...overrides };
}

function assertUnicodeScalars(value: string, offset: number): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new IJsonParseError(
          "JSON_INVALID_UNICODE",
          "Unpaired high surrogate",
          offset,
        );
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new IJsonParseError(
        "JSON_INVALID_UNICODE",
        "Unpaired low surrogate",
        offset,
      );
    }
  }
}

class Parser {
  readonly #source: string;
  readonly #limits: IJsonLimits;
  #offset = 0;
  #values = 0;

  constructor(source: string, limits: IJsonLimits) {
    this.#source = source;
    this.#limits = limits;
  }

  parse(): JsonValue {
    this.#skipWhitespace();
    const value = this.#parseValue(0);
    this.#skipWhitespace();
    if (this.#offset !== this.#source.length) {
      throw new IJsonParseError(
        "JSON_TRAILING_CONTENT",
        "Unexpected content after the JSON value",
        this.#offset,
      );
    }
    return value;
  }

  #parseValue(depth: number): JsonValue {
    if (depth > this.#limits.maxDepth) {
      throw new IJsonParseError(
        "JSON_DEPTH_EXCEEDED",
        "JSON nesting depth exceeded",
        this.#offset,
      );
    }
    this.#values += 1;
    if (this.#values > this.#limits.maxValues) {
      throw new IJsonParseError(
        "JSON_LIMIT_EXCEEDED",
        "JSON value count exceeded",
        this.#offset,
      );
    }

    const character = this.#source[this.#offset];
    if (character === '"') return this.#parseString();
    if (character === "{") return this.#parseObject(depth + 1);
    if (character === "[") return this.#parseArray(depth + 1);
    if (character === "t") return this.#parseLiteral("true", true);
    if (character === "f") return this.#parseLiteral("false", false);
    if (character === "n") return this.#parseLiteral("null", null);
    if (
      character === "-" ||
      (character !== undefined && character >= "0" && character <= "9")
    ) {
      return this.#parseNumber();
    }
    throw new IJsonParseError(
      "JSON_INVALID_SYNTAX",
      "Expected a JSON value",
      this.#offset,
    );
  }

  #parseLiteral<T extends JsonValue>(token: string, value: T): T {
    if (
      this.#source.slice(this.#offset, this.#offset + token.length) !== token
    ) {
      throw new IJsonParseError(
        "JSON_INVALID_SYNTAX",
        `Expected ${token}`,
        this.#offset,
      );
    }
    this.#offset += token.length;
    return value;
  }

  #parseString(): string {
    const start = this.#offset;
    this.#offset += 1;
    while (this.#offset < this.#source.length) {
      const unit = this.#source.charCodeAt(this.#offset);
      if (unit === 0x22) {
        this.#offset += 1;
        let value: string;
        try {
          value = JSON.parse(this.#source.slice(start, this.#offset));
        } catch {
          throw new IJsonParseError(
            "JSON_INVALID_SYNTAX",
            "Invalid JSON string",
            start,
          );
        }
        assertUnicodeScalars(value, start);
        if ([...value].length > this.#limits.maxStringCodePoints) {
          throw new IJsonParseError(
            "JSON_LIMIT_EXCEEDED",
            "JSON string is too long",
            start,
          );
        }
        return value;
      }
      if (unit < 0x20) {
        throw new IJsonParseError(
          "JSON_INVALID_SYNTAX",
          "Unescaped control character",
          this.#offset,
        );
      }
      if (unit === 0x5c) {
        this.#offset += 1;
        const escape = this.#source[this.#offset];
        if (escape === "u") {
          const digits = this.#source.slice(this.#offset + 1, this.#offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
            throw new IJsonParseError(
              "JSON_INVALID_SYNTAX",
              "Invalid Unicode escape",
              this.#offset,
            );
          }
          this.#offset += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) {
          throw new IJsonParseError(
            "JSON_INVALID_SYNTAX",
            "Invalid string escape",
            this.#offset,
          );
        }
      }
      this.#offset += 1;
    }
    throw new IJsonParseError(
      "JSON_INVALID_SYNTAX",
      "Unterminated JSON string",
      start,
    );
  }

  #parseNumber(): number {
    const start = this.#offset;
    const remaining = this.#source.slice(start);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      remaining,
    );
    if (!match)
      throw new IJsonParseError(
        "JSON_INVALID_NUMBER",
        "Invalid JSON number",
        start,
      );
    const token = match[0];
    this.#offset += token.length;
    const next = this.#source[this.#offset];
    if (next !== undefined && !/\s|,|\]|}/.test(next)) {
      throw new IJsonParseError(
        "JSON_INVALID_NUMBER",
        "Invalid character after number",
        this.#offset,
      );
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new IJsonParseError(
        "JSON_INVALID_NUMBER",
        "Number is outside binary64 range",
        start,
      );
    }
    if (!/[.eE]/.test(token) && !Number.isSafeInteger(value)) {
      throw new IJsonParseError(
        "JSON_INVALID_NUMBER",
        "Integer is outside the interoperable safe range",
        start,
      );
    }
    return value;
  }

  #parseArray(depth: number): JsonValue[] {
    if (depth > this.#limits.maxDepth) {
      throw new IJsonParseError(
        "JSON_DEPTH_EXCEEDED",
        "JSON nesting depth exceeded",
        this.#offset,
      );
    }
    const values: JsonValue[] = [];
    this.#offset += 1;
    this.#skipWhitespace();
    if (this.#source[this.#offset] === "]") {
      this.#offset += 1;
      return values;
    }
    while (true) {
      if (values.length >= this.#limits.maxArrayLength) {
        throw new IJsonParseError(
          "JSON_LIMIT_EXCEEDED",
          "JSON array is too long",
          this.#offset,
        );
      }
      values.push(this.#parseValue(depth));
      this.#skipWhitespace();
      const delimiter = this.#source[this.#offset];
      this.#offset += 1;
      if (delimiter === "]") return values;
      if (delimiter !== ",") {
        throw new IJsonParseError(
          "JSON_INVALID_SYNTAX",
          "Expected ',' or ']'",
          this.#offset - 1,
        );
      }
      this.#skipWhitespace();
    }
  }

  #parseObject(depth: number): Record<string, JsonValue> {
    if (depth > this.#limits.maxDepth) {
      throw new IJsonParseError(
        "JSON_DEPTH_EXCEEDED",
        "JSON nesting depth exceeded",
        this.#offset,
      );
    }
    const value: Record<string, JsonValue> = {};
    const keys = new Set<string>();
    this.#offset += 1;
    this.#skipWhitespace();
    if (this.#source[this.#offset] === "}") {
      this.#offset += 1;
      return value;
    }
    while (true) {
      if (keys.size >= this.#limits.maxObjectProperties) {
        throw new IJsonParseError(
          "JSON_LIMIT_EXCEEDED",
          "JSON object is too large",
          this.#offset,
        );
      }
      if (this.#source[this.#offset] !== '"') {
        throw new IJsonParseError(
          "JSON_INVALID_SYNTAX",
          "Expected an object key",
          this.#offset,
        );
      }
      const keyOffset = this.#offset;
      const key = this.#parseString();
      if (keys.has(key)) {
        throw new IJsonParseError(
          "JSON_DUPLICATE_KEY",
          `Duplicate object key ${JSON.stringify(key)}`,
          keyOffset,
        );
      }
      keys.add(key);
      this.#skipWhitespace();
      if (this.#source[this.#offset] !== ":") {
        throw new IJsonParseError(
          "JSON_INVALID_SYNTAX",
          "Expected ':' after object key",
          this.#offset,
        );
      }
      this.#offset += 1;
      this.#skipWhitespace();
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        value: this.#parseValue(depth),
        writable: true,
      });
      this.#skipWhitespace();
      const delimiter = this.#source[this.#offset];
      this.#offset += 1;
      if (delimiter === "}") return value;
      if (delimiter !== ",") {
        throw new IJsonParseError(
          "JSON_INVALID_SYNTAX",
          "Expected ',' or '}'",
          this.#offset - 1,
        );
      }
      this.#skipWhitespace();
    }
  }

  #skipWhitespace(): void {
    while (
      /\s/.test(this.#source[this.#offset] ?? "") &&
      this.#source[this.#offset] !== "\u00a0"
    ) {
      const character = this.#source[this.#offset];
      if (
        character !== " " &&
        character !== "\t" &&
        character !== "\n" &&
        character !== "\r"
      )
        break;
      this.#offset += 1;
    }
  }
}

export function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value))
    return value.map((entry) => cloneJson(entry)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const clone: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneJson(child),
        writable: true,
      });
    }
    return clone as T;
  }
  return value;
}

export function parseIJson(
  input: string | Uint8Array,
  overrides: Partial<IJsonLimits> = {},
): ParsedIJson {
  const limits = mergeLimits(overrides);
  let sourceText: string;
  let utf8Bytes: number;

  if (typeof input === "string") {
    sourceText = input;
    utf8Bytes = new TextEncoder().encode(input).byteLength;
  } else {
    utf8Bytes = input.byteLength;
    try {
      sourceText = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new IJsonParseError(
        "JSON_INVALID_UNICODE",
        "Input is not valid UTF-8",
        0,
      );
    }
  }

  if (utf8Bytes > limits.maxBytes) {
    throw new IJsonParseError(
      "JSON_LIMIT_EXCEEDED",
      "JSON byte limit exceeded",
      0,
    );
  }
  if (sourceText.charCodeAt(0) === 0xfeff) {
    throw new IJsonParseError(
      "JSON_BOM_FORBIDDEN",
      "A byte-order mark is not permitted",
      0,
    );
  }

  const value = deepFreezeJson(new Parser(sourceText, limits).parse());
  return Object.freeze({ value, sourceText, utf8Bytes });
}
