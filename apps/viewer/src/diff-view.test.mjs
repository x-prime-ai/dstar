import { expect, it } from "vitest";
import { diffLines, compactDiff, changedText } from "../public/diff-view.js";
import { fileDiff } from "./file-diff.mjs";

it.each([
  ["", ""],
  ["", "hello\nworld"],
  ["hello\n", ""],
  ["a\nb\nc", "a\nnew\nc"],
  ["a\na\nb", "a\nb\nb"],
  ["🌍\n你好\n", "🌎\n你好\nnew\n"],
  ["a\r\nb", "a\nb"],
])("reconstructs exact before and after lines for %j → %j", (before, after) => {
  const { rows } = diffLines(before, after);
  expect(
    rows
      .filter((r) => r.kind !== "add")
      .map((r) => r.text)
      .join("\n"),
  ).toBe(before);
  expect(
    rows
      .filter((r) => r.kind !== "remove")
      .map((r) => r.text)
      .join("\n"),
  ).toBe(after);
  expect(rows.filter((r) => r.oldLine !== null).map((r) => r.oldLine)).toEqual(
    Array.from(
      { length: before ? before.split("\n").length : 0 },
      (_, i) => i + 1,
    ),
  );
  expect(rows.filter((r) => r.newLine !== null).map((r) => r.newLine)).toEqual(
    Array.from(
      { length: after ? after.split("\n").length : 0 },
      (_, i) => i + 1,
    ),
  );
});

it("keeps unchanged context around edits and collapses long unchanged sections", () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 20", "updated 20");
  const rows = compactDiff(diffLines(before, after).rows);
  expect(rows[0]).toEqual({ kind: "skip", count: 17 });
  expect(
    rows.filter((r) => ["add", "remove"].includes(r.kind)).map((r) => r.text),
  ).toEqual(["line 20", "updated 20"]);
  expect(rows.at(-1)).toEqual({ kind: "skip", count: 16 });
});

it("uses a bounded block fallback for large rewrites", () => {
  const before = Array.from({ length: 900 }, (_, i) => `old ${i}`).join("\n");
  const after = Array.from({ length: 900 }, (_, i) => `new ${i}`).join("\n");
  const result = diffLines(before, after);
  expect(result.coarse).toBe(true);
  expect(
    result.rows
      .filter((r) => r.kind === "remove")
      .map((r) => r.text)
      .join("\n"),
  ).toBe(before);
  expect(
    result.rows
      .filter((r) => r.kind === "add")
      .map((r) => r.text)
      .join("\n"),
  ).toBe(after);
});

it("highlights content without splitting Unicode characters or losing common text", () => {
  const result = changedText("Hello 🌍 world", "Hello 🌎 world");
  expect(result).toEqual({
    prefix: "Hello ",
    removed: "🌍",
    added: "🌎",
    suffix: " world",
  });
  expect(changedText("One document", "One simple document")).toEqual({
    prefix: "One ",
    removed: "",
    added: "simple ",
    suffix: "document",
  });
  expect(changedText("same", "same")).toEqual({
    prefix: "same",
    removed: "",
    added: "",
    suffix: "",
  });
});

function fixture(path = "document.html") {
  const text = "a".repeat(200) + "original";
  const before = {
    files: new Map([[path, Buffer.from(text)]]),
    index: { elements: { intro: { text, tag: "p" } } },
  };
  const after = {
    files: new Map([[path, Buffer.from(text + " updated")]]),
    index: { elements: { intro: { text: text + " updated", tag: "p" } } },
  };
  const proposal = {
    id: "proposal",
    base: "old",
    revision: "new",
    diff: {
      files: [{ path, kind: "modified" }],
      elements: [{ id: "intro", changes: ["text"] }],
      elementChangeCount: 1,
    },
  };
  return { before, after, proposal, path };
}

it("reads full immutable text rather than the 160-character proposal summary", () => {
  const f = fixture();
  const result = fileDiff(f.before, f.after, f.proposal, f.path);
  expect(result.before.text).toBe("a".repeat(200) + "original");
  expect(result.elements[0].after.text).toBe(
    "a".repeat(200) + "original updated",
  );
  expect(result.elements[0].after.truncated).toBe(false);
  expect(result).toMatchObject({
    proposalId: "proposal",
    base: "old",
    revision: "new",
    path: "document.html",
  });
  expect(() =>
    fileDiff(f.before, f.after, f.proposal, "../state.json"),
  ).toThrow("changed file");
});

it("handles first versions and removed files without inventing a base", () => {
  const f = fixture();
  const first = fileDiff(null, f.after, { ...f.proposal, base: null }, f.path);
  expect(first.before).toEqual({
    exists: false,
    bytes: 0,
    omitted: false,
    text: "",
  });
  expect(first.elements[0].before).toBeNull();
  const removed = fileDiff(
    f.before,
    { files: new Map(), index: null },
    f.proposal,
    f.path,
  );
  expect(removed.after.exists).toBe(false);
  expect(removed.elements[0].after).toBeNull();
});

it("does not decode binary assets and discloses oversized source or element text", () => {
  const binary = fixture("assets/photo.png");
  const asset = fileDiff(
    binary.before,
    binary.after,
    binary.proposal,
    binary.path,
  );
  expect(asset.isText).toBe(false);
  expect(asset.before.text).toBeNull();
  expect(asset.elements).toEqual([]);
  const f = fixture();
  f.after.files.set(f.path, Buffer.alloc(512 * 1024 + 1));
  f.after.index.elements.intro.text = "🌍".repeat(9000);
  const large = fileDiff(f.before, f.after, f.proposal, f.path);
  expect(large.after).toMatchObject({ omitted: true, text: null });
  expect(large.elements[0].after).toMatchObject({
    truncated: true,
    text: "🌍".repeat(8000),
  });
});
