import { describe, expect, it } from "vitest";
import { revision } from "./delta.js";
import { replaceTargetText } from "./suggestion.js";
import type { Files, Target } from "./types.js";

const fixture = (): Files =>
  new Map([
    [
      "document.html",
      Buffer.from(
        '<!doctype html><html><head><title>Test</title></head><body><p data-dstar-id="intro">Hello <strong>brave &amp; new</strong> world.</p></body></html>',
      ),
    ],
    ["styles.css", Buffer.from("p { color: black; }")],
  ]);

const target = (
  files: Files,
  start: number,
  end: number,
  exact: string,
): Target => ({
  revision: revision(files),
  element: "intro",
  selector: {
    type: "text-range",
    start,
    end,
    unit: "unicode-code-point",
    exact,
  },
});

describe("manual text suggestions", () => {
  it("replaces an exact range across inline nodes and preserves other files", () => {
    const files = fixture(),
      next = replaceTargetText(
        files,
        target(files, 0, 11, "Hello brave"),
        "Hi",
      );
    expect(next.get("document.html")?.toString()).toContain(
      '<p data-dstar-id="intro">Hi<strong> &amp; new</strong> world.</p>',
    );
    expect(next.get("styles.css")).toBe(files.get("styles.css"));
    expect(files.get("document.html")?.toString()).toContain("Hello");
  });

  it("escapes replacement text and rejects non-text or mismatched targets", () => {
    const files = fixture(),
      next = replaceTargetText(
        files,
        target(files, 6, 17, "brave & new"),
        "safer <copy> & text",
      );
    expect(next.get("document.html")?.toString()).toContain(
      "safer &lt;copy&gt; &amp; text",
    );
    expect(() =>
      replaceTargetText(
        files,
        {
          ...target(files, 0, 5, "Hello"),
          revision: "sha256:" + "0".repeat(64),
        },
        "Hi",
      ),
    ).toThrow("source revision");
    expect(() =>
      replaceTargetText(
        files,
        {
          ...target(files, 0, 5, "Hello"),
          selector: { type: "element" },
        },
        "Hi",
      ),
    ).toThrow("within one element");
  });
});
