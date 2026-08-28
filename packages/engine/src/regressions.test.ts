import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Repository, readCandidate } from "./repository.js";
import { resolveTarget, validateHtml } from "./html.js";
import type { Target } from "./types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0))
    fs.rmSync(path, { recursive: true, force: true });
});
const document = (body: string) =>
  Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>Regression</title></head><body>${body}</body></html>`,
  );
const index = (body: string) =>
  validateHtml(new Map([["document.html", document(body)]]));
function setup(body = '<p data-dstar-id="intro">Hello</p>') {
  const temp = fs.mkdtempSync(join(tmpdir(), "dstar-regression-"));
  temporary.push(temp);
  const stage = join(temp, "stage"),
    root = join(temp, "doc");
  fs.mkdirSync(stage);
  fs.writeFileSync(join(stage, "document.html"), document(body));
  const repo = new Repository(root);
  const propose = () =>
    repo.propose({
      candidate: stage,
      base: fs.existsSync(join(root, ".dstar/state.json"))
        ? repo.snapshot().revision
        : null,
      request: "Regression",
      author: "agent",
      key: randomUUID(),
    });
  const accept = (id: string, revision: string) =>
    repo.decide(id, "accept", revision, repo.snapshot().stateId, "human");
  return { temp, stage, root, repo, propose, accept };
}
const target = (exact: string, prefix = "", suffix = ""): Target => ({
  revision: `sha256:${"0".repeat(64)}`,
  element: "intro",
  selector: {
    type: "text-range",
    unit: "unicode-code-point",
    start: 0,
    end: [...exact].length,
    exact,
    prefix,
    suffix,
  },
});

describe("HTML5 comment text", () => {
  it("rejects deep trees before recursively indexing a stable ancestor", () => {
    expect(() =>
      index(
        '<div data-dstar-id="intro">' +
          "<div>".repeat(5000) +
          "deep" +
          "</div>".repeat(5001),
      ),
    ).toThrow("HTML resource limit exceeded");
  });
  it("normalizes source newlines and pre leading LF without changing canonical bytes", () => {
    const f = setup(
      '<p data-dstar-id="intro">first\r\nsecond\rthird</p><pre data-dstar-id="pre">\r\nalpha</pre><pre data-dstar-id="entity">&#10;beta&#13;gamma</pre>',
    );
    const original = fs.readFileSync(join(f.stage, "document.html"));
    const p = f.propose();
    const s = f.repo.snapshot(p.id);
    expect(s.index!.elements.intro!.text).toBe("first\nsecond\nthird");
    expect(s.index!.elements.pre!.text).toBe("alpha");
    expect(s.index!.elements.entity!.text).toBe("beta\rgamma");
    for (const [element, start, end, exact] of [
      ["intro", 6, 12, "second"],
      ["pre", 0, 5, "alpha"],
    ] as const) {
      expect(
        f.repo.comment({
          author: "human",
          body: "DOM selection",
          target: {
            revision: p.revision,
            element,
            selector: {
              type: "text-range",
              unit: "unicode-code-point",
              start,
              end,
              exact,
            },
          },
        }).target.selector,
      ).toMatchObject({ start, end, exact });
    }
    f.accept(p.id, p.revision);
    expect(fs.readFileSync(join(f.root, "document.html"))).toEqual(original);
    const out = join(f.temp, "export");
    f.repo.export(out, p.id);
    expect(fs.readFileSync(join(out, "document.html"))).toEqual(original);
    expect(new Repository(f.root).snapshot().revision).toBe(p.revision);
  });
  it("uses browser tree construction for implicit paragraph closure and table bodies", () => {
    const parsed = index(
      '<p data-dstar-id="intro">before<div data-dstar-id="block">inside</div><table data-dstar-id="table"><tr data-dstar-id="row"><td>cell</td></tr></table>',
    );
    expect(parsed.elements.intro!.text).toBe("before");
    expect(parsed.elements.block!.parent).toBeNull();
    expect(parsed.elements.row!.parent).toBe("table");
    expect(parsed.elements.table!.text).toBe("cell");
  });
  it.each(["constructor", "toString", "hasOwnProperty", "valueOf"])(
    "supports stable ID %s in the genesis diff",
    (id) => {
      const f = setup(`<p data-dstar-id="${id}">Hello</p>`),
        p = f.propose();
      expect(p.diff.elements).toMatchObject([
        { id, changes: ["inserted"], before: null, after: { text: "Hello" } },
      ]);
      f.accept(p.id, p.revision);
      expect(f.repo.snapshot().index!.elements[id]!.text).toBe("Hello");
    },
  );
});

describe("linear anchor recovery", () => {
  it("handles Unicode context, overlaps and duplicate matches without guessing", () => {
    const parsed = index(
      '<p data-dstar-id="intro">x🌍你文🌟 y🌍你文🌙 aaaaa</p>',
    );
    expect(resolveTarget(parsed, target("你文", "🌍", "🌟"))).toEqual({
      status: "recovered",
      start: 2,
      end: 4,
    });
    expect(resolveTarget(parsed, target("你文", "🌍"))).toEqual({
      status: "ambiguous",
    });
    expect(resolveTarget(parsed, target("aaa"))).toEqual({
      status: "ambiguous",
    });
    expect(resolveTarget(parsed, target("你文", "🌍", "missing"))).toEqual({
      status: "orphaned",
    });
  });
  it("matches a small exhaustive code-point oracle", () => {
    for (let bits = 0; bits < 64; bits++) {
      const text =
        "x" +
        Array.from({ length: 6 }, (_, i) =>
          bits & (1 << i) ? "🌍" : "a",
        ).join("");
      const parsed = index(`<p data-dstar-id="intro">${text}</p>`),
        chars = [...text];
      for (const exact of ["a", "🌍", "aa", "a🌍"])
        for (const prefix of ["", "a", "🌍"])
          for (const suffix of ["", "a", "🌍"]) {
            const hits: number[] = [];
            for (let i = 0; i < chars.length; i++)
              if (
                chars.slice(i, i + [...exact].length).join("") === exact &&
                chars.slice(0, i).join("").endsWith(prefix) &&
                chars
                  .slice(i + [...exact].length)
                  .join("")
                  .startsWith(suffix)
              )
                hits.push(i);
            expect(
              resolveTarget(parsed, target(exact, prefix, suffix)),
            ).toEqual(
              hits.length === 1
                ? {
                    status: "recovered",
                    start: hits[0],
                    end: hits[0]! + [...exact].length,
                  }
                : { status: hits.length ? "ambiguous" : "orphaned" },
            );
          }
    }
  });
  it("bounds work on repetitive long text and long almost-matching selectors", () => {
    const parsed = index(`<p data-dstar-id="intro">x${"a".repeat(200000)}</p>`);
    const started = performance.now();
    expect(resolveTarget(parsed, target("a", "z"))).toEqual({
      status: "orphaned",
    });
    expect(resolveTarget(parsed, target("a".repeat(20000) + "b"))).toEqual({
      status: "orphaned",
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("file/directory checkout transitions", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const prepare = (direction: string) => {
    const f = setup(),
      paths =
        direction === "file-to-directory"
          ? ["assets/a.png", "assets/a.png/nested/b.png"]
          : ["assets/a.png/nested/b.png", "assets/a.png"];
    const [before, after] = paths as [string, string];
    fs.mkdirSync(dirname(join(f.stage, before)), { recursive: true });
    fs.writeFileSync(join(f.stage, before), png);
    const a = f.propose();
    f.accept(a.id, a.revision);
    fs.rmSync(join(f.stage, "assets"), { recursive: true });
    fs.mkdirSync(dirname(join(f.stage, after)), { recursive: true });
    fs.writeFileSync(join(f.stage, after), png);
    const b = f.propose();
    return { ...f, a, b, before, after };
  };
  for (const direction of ["file-to-directory", "directory-to-file"]) {
    it(`accepts ${direction} normally`, () => {
      const f = prepare(direction);
      f.accept(f.b.id, f.b.revision);
      expect(new Repository(f.root).snapshot().files).toEqual(
        readCandidate(f.stage),
      );
    });
    it.each(["before", "after"])(
      `recovers ${direction} after failure %s state swap`,
      (when) => {
        const f = prepare(direction),
          stateId = f.repo.snapshot().stateId;
        const originalRename = vi
          .mocked(fs.renameSync)
          .getMockImplementation()!;
        vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
          if (String(destination) === join(f.repo.meta, "state.json")) {
            if (when === "after") originalRename(source, destination);
            throw new Error("Injected state swap failure");
          }
          return originalRename(source, destination);
        });
        try {
          expect(() =>
            f.repo.decide(f.b.id, "accept", f.b.revision, stateId, "human"),
          ).toThrow("Injected state swap failure");
        } finally {
          vi.mocked(fs.renameSync).mockImplementation(originalRename);
        }
        const expected = when === "before" ? f.a : f.b;
        const reopened = new Repository(f.root).snapshot();
        expect(reopened.revision).toBe(expected.revision);
        expect(reopened.files).toEqual(f.repo.snapshot(expected.id).files);
        expect(
          fs.readFileSync(join(f.root, when === "before" ? f.before : f.after)),
        ).toEqual(png);
        expect(fs.existsSync(join(f.root, ".dstar/journal.json"))).toBe(false);
        expect(new Repository(f.root).snapshot().files).toEqual(reopened.files);
      },
    );
  }
  it("never recursively removes an unrelated file during recovery", () => {
    const f = prepare("file-to-directory");
    // Model interruption after the new files were installed but before state swap.
    fs.unlinkSync(join(f.root, f.before));
    fs.mkdirSync(dirname(join(f.root, f.after)), { recursive: true });
    fs.writeFileSync(join(f.root, f.after), png);
    const unrelated = join(f.root, "assets/a.png/keep.png");
    fs.writeFileSync(unrelated, png);
    fs.writeFileSync(
      join(f.root, ".dstar/journal.json"),
      JSON.stringify({ paths: [f.before, f.after] }),
    );
    expect(() => new Repository(f.root).snapshot()).toThrow();
    expect(fs.readFileSync(unrelated)).toEqual(png);
    expect(fs.existsSync(join(f.root, ".dstar/journal.json"))).toBe(true);
  });
});
