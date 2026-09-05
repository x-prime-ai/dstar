import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import {
  applyDelta,
  createDelta,
  decodeFile,
  digest,
  encodeFile,
  revision,
} from "./delta.js";
import { readCandidate, Repository } from "./repository.js";
import { resolveTarget, reviewDiff, validateHtml } from "./html.js";
import type { Proposal, Target } from "./types.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
const html = (text = "Hello 🌍 world", id = "intro") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Test</title><link rel="stylesheet" href="styles.css"></head><body><main data-dstar-id="main"><p data-dstar-id="${id}">${text}</p></main></body></html>`;
function setup() {
  const temp = fs.mkdtempSync(join(tmpdir(), "dstar-engine-"));
  temporary.push(temp);
  const stage = join(temp, "stage"),
    root = join(temp, "document");
  fs.mkdirSync(stage);
  const write = (text = "Hello 🌍 world", id = "intro") => {
    fs.writeFileSync(join(stage, "document.html"), html(text, id));
    fs.writeFileSync(join(stage, "styles.css"), "body{color:#123456}");
  };
  write();
  const repo = new Repository(root);
  const propose = (
    base: string | null = repo.snapshot().revision,
    key = randomUUID(),
  ) =>
    repo.propose({
      candidate: stage,
      base,
      request: "Review edit",
      author: "agent",
      key,
    });
  const accept = (p: Proposal) =>
    repo.decide(p.id, "accept", p.revision, repo.snapshot().stateId, "human");
  return { temp, root, stage, write, repo, propose, accept };
}
describe("byte deltas", () => {
  it("roundtrips arbitrary bytes, Unicode, inserts, deletes and moves", () => {
    for (const size of [0, 1, 63, 64, 65, 1024, 80000]) {
      const base = randomBytes(size);
      const next = Buffer.concat([
        Buffer.from("你好 🌍"),
        base.subarray(size / 3),
        Buffer.from("middle"),
        base.subarray(0, size / 3),
      ]);
      expect(applyDelta(base, createDelta(base, next))).toEqual(next);
      const encoded = encodeFile(base, next);
      expect(decodeFile(base, encoded.storage, encoded.bytes)).toEqual(next);
    }
  });
  it("stores a small delta for local edits and verifies compressed objects", () => {
    const base = randomBytes(100000),
      next = Buffer.from(base);
    next.write("hello", 45000);
    const encoded = encodeFile(base, next);
    expect(encoded.storage.encoding).toBe("gzip-delta-v1");
    expect(encoded.bytes.length).toBeLessThan(500);
    const corrupt = Buffer.from(encoded.bytes);
    corrupt[10] = corrupt[10]! ^ 1;
    expect(() => decodeFile(base, encoded.storage, corrupt)).toThrow(
      "Corrupt history",
    );
    expect(() =>
      applyDelta(base, Buffer.from('{"version":1,"ops":[{"copy":[-1,2]}]}')),
    ).toThrow();
  });
});

it("persists reply idempotency under the write lock without resolving or accepting", () => {
  const f = setup(),
    p = f.propose(null);
  const target: Target = {
    revision: p.revision,
    element: "intro",
    selector: { type: "element" },
  };
  const c = f.repo.comment({ target, body: "Please edit", author: "human" });
  const first = f.repo.reply(c.id, "Proposing", "agent", "reply-key");
  const stateId = f.repo.snapshot().stateId;
  const reopened = new Repository(f.root);
  expect(reopened.reply(c.id, "Proposing", "agent", "reply-key")).toEqual(
    first,
  );
  expect(reopened.snapshot().stateId).toBe(stateId);
  expect(() => reopened.reply(c.id, "Changed", "agent", "reply-key")).toThrow(
    "Idempotency",
  );
  expect(() => reopened.reply(c.id, "Proposing", "human", "reply-key")).toThrow(
    "Idempotency",
  );
  const other = reopened.comment({ target, body: "Another", author: "human" });
  expect(() =>
    reopened.reply(other.id, "Proposing", "agent", "reply-key"),
  ).toThrow("Idempotency");
  // Existing human/CLI callers may still omit the optional fourth argument.
  expect(reopened.reply(c.id, "Thanks", "human").replies).toHaveLength(2);
  expect(() =>
    reopened.reply(c.id, "Stale draft", "human", undefined, stateId),
  ).toThrow("state changed");
  // A keyed exact retry is authoritative even when its original state is old.
  expect(
    reopened.reply(c.id, "Proposing", "agent", "reply-key", stateId).replies,
  ).toHaveLength(2);
  expect(reopened.snapshot().revision).toBeNull();
  expect(reopened.snapshot().state.comments[0]?.status).toBe("open");
});
it("persists validated motivating comments without coupling their lifecycle", () => {
  const f = setup(),
    first = f.propose(null);
  f.accept(first);
  const target: Target = {
      revision: first.revision,
      element: "intro",
      selector: { type: "element" },
    },
    a = f.repo.comment({ target, body: "Clarify this", author: "human" }),
    b = f.repo.comment({ target, body: "Shorten this", author: "human" });
  f.write("Updated for both comments");
  const proposal = f.repo.propose({
    candidate: f.stage,
    base: first.revision,
    request: "Address review feedback",
    author: "agent",
    key: "linked-proposal",
    commentIds: [b.id, a.id],
  });
  expect(proposal.motivatedBy).toEqual([a.id, b.id].sort());
  expect(
    new Repository(f.root).snapshot().state.proposals.at(-1)?.motivatedBy,
  ).toEqual([a.id, b.id].sort());
  f.accept(proposal);
  expect(
    f.repo.snapshot().state.comments.every((c) => c.status === "open"),
  ).toBe(true);
  f.repo.resolveComment(a.id, f.repo.snapshot().stateId);
  // An exact retry remains idempotent even after the linked comment changes state.
  expect(
    f.repo.propose({
      candidate: f.stage,
      base: first.revision,
      request: "Address review feedback",
      author: "agent",
      key: "linked-proposal",
      commentIds: [a.id, b.id],
    }).id,
  ).toBe(proposal.id);
  expect(() =>
    f.repo.propose({
      candidate: f.stage,
      base: first.revision,
      request: "Address review feedback",
      author: "agent",
      key: "linked-proposal",
      commentIds: [a.id],
    }),
  ).toThrow("Idempotency");
  f.write("Another update");
  expect(() =>
    f.repo.propose({
      candidate: f.stage,
      base: proposal.revision,
      request: "Reuse resolved motivation",
      author: "agent",
      key: "resolved-link",
      commentIds: [a.id],
    }),
  ).toThrow("no longer open");
  expect(() =>
    f.repo.propose({
      candidate: f.stage,
      base: proposal.revision,
      request: "Unknown motivation",
      author: "agent",
      key: "unknown-link",
      commentIds: [randomUUID()],
    }),
  ).toThrow("Unknown motivating comment");
});
describe("canonical HTML workflow", () => {
  it("creates a pending genesis, accepts the exact candidate, and reopens without Git", () => {
    const f = setup(),
      p = f.propose(null);
    expect(f.repo.snapshot().revision).toBeNull();
    expect(fs.existsSync(join(f.root, "document.html"))).toBe(false);
    expect(p.diff.elements.length).toBe(2);
    f.accept(p);
    const reopened = new Repository(f.root).snapshot();
    expect(reopened.revision).toBe(p.revision);
    expect(reopened.files).toEqual(readCandidate(f.stage));
    expect(fs.existsSync(join(f.root, ".git"))).toBe(false);
  });
  it("preserves exact history and assets across edits, deletion and checkpoints", () => {
    const f = setup();
    fs.mkdirSync(join(f.stage, "assets"));
    const image = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      randomBytes(40000),
    ]);
    fs.writeFileSync(join(f.stage, "assets/photo.png"), image);
    const first = f.propose(null);
    f.accept(first);
    let latest = first;
    for (let i = 2; i <= 21; i++) {
      f.write(`Revision ${i}`);
      latest = f.propose();
      expect(latest.changes.some((c) => c.path === "assets/photo.png")).toBe(
        false,
      );
      f.accept(latest);
    }
    expect(
      f.repo.snapshot(first.id).files.get("document.html")?.toString(),
    ).toBe(html());
    expect(f.repo.snapshot().revision).toBe(latest.revision);
    expect(f.repo.snapshot().state.proposals[19]?.checkpoint).toBeDefined();
    fs.unlinkSync(join(f.stage, "assets/photo.png"));
    const removed = f.propose();
    f.accept(removed);
    expect(fs.existsSync(join(f.root, "assets/photo.png"))).toBe(false);
    expect(f.repo.snapshot(first.id).files.get("assets/photo.png")).toEqual(
      image,
    );
    const imageObject = encodeFile(undefined, image).storage.object.slice(7);
    expect(
      fs
        .readdirSync(join(f.root, ".dstar/objects"))
        .filter((name) => name === imageObject),
    ).toHaveLength(1);
    const out = join(f.temp, "export");
    f.repo.export(out, first.id);
    expect(readCandidate(out)).toEqual(f.repo.snapshot(first.id).files);
    const withoutCheckpoints = f.repo.load();
    for (const p of withoutCheckpoints.proposals) delete p.checkpoint;
    fs.writeFileSync(
      join(f.root, ".dstar/state.json"),
      JSON.stringify(withoutCheckpoints),
    );
    expect(f.repo.snapshot().revision).toBe(removed.revision);
    expect(f.repo.snapshot(first.id).files.get("assets/photo.png")).toEqual(
      image,
    );
  }, 15000);
  it("freezes proposed bytes, reviews CSS-only edits, and rejects without changing head", () => {
    const f = setup(),
      first = f.propose(null);
    f.accept(first);
    fs.writeFileSync(join(f.stage, "styles.css"), "body{color:#abcdef}");
    const p = f.propose();
    expect(p.diff.files.map((f) => f.path)).toEqual(["styles.css"]);
    expect(p.diff.elementChangeCount).toBe(0);
    f.write("Changed after submission");
    expect(f.repo.snapshot(p.id).files.get("document.html")?.toString()).toBe(
      html(),
    );
    f.repo.decide(
      p.id,
      "reject",
      p.revision,
      f.repo.snapshot().stateId,
      "human",
    );
    expect(f.repo.snapshot().revision).toBe(first.revision);
    expect(f.repo.snapshot(p.id).files.get("styles.css")?.toString()).toBe(
      "body{color:#abcdef}",
    );
  });
  it("bounds persisted review summaries and does not guess ambiguous anchors", () => {
    const f = setup();
    f.write(
      Array.from(
        { length: 300 },
        (_, i) =>
          `<span data-dstar-id="item-${i}">${"word ".repeat(100)}</span>`,
      ).join(""),
    );
    const p = f.propose(null);
    expect(p.diff.elementChangeCount).toBe(302);
    expect(p.diff.elements).toHaveLength(200);
    expect(
      p.diff.elements.every((e) => [...(e.after?.text ?? "")].length <= 160),
    ).toBe(true);
    const files = new Map([
      ["document.html", Buffer.from(html("XX repeat repeat"))],
      ["styles.css", Buffer.from("")],
    ]);
    expect(
      resolveTarget(validateHtml(files), {
        revision: p.revision,
        element: "intro",
        selector: {
          type: "text-range",
          start: 0,
          end: 6,
          unit: "unicode-code-point",
          exact: "repeat",
        },
      }).status,
    ).toBe("ambiguous");
  });
  it("refuses legacy packages and held locks with actionable errors", () => {
    const f = setup();
    fs.mkdirSync(f.root);
    fs.writeFileSync(join(f.root, "document.json"), "{}");
    expect(() => new Repository(f.root)).toThrow("Legacy package");
    fs.unlinkSync(join(f.root, "document.json"));
    const p = f.propose(null);
    f.accept(p);
    fs.writeFileSync(
      join(f.root, ".dstar/write.lock"),
      JSON.stringify({ pid: process.pid }),
    );
    expect(() => f.repo.snapshot()).toThrow("Package locked");
  });
  it("is idempotent and rejects stale base, stale review state and no-op edits", () => {
    const f = setup(),
      a = f.propose(null, "first");
    expect(f.propose(null, "first").id).toBe(a.id);
    f.accept(a);
    expect(() => f.propose()).toThrow("No content");
    f.write("Second");
    expect(() => f.propose(null)).toThrow("Stale base");
    expect(() => f.propose(a.revision, "first")).toThrow("Idempotency");
    const b = f.propose(),
      state = f.repo.snapshot().stateId;
    f.write("Competing");
    const c = f.propose();
    expect(() =>
      f.repo.decide(b.id, "accept", b.revision, state, "human"),
    ).toThrow("state changed");
    f.accept(b);
    expect(() => f.accept(c)).toThrow("Stale proposal");
    expect(f.repo.snapshot().revision).toBe(b.revision);
  });
  it("anchors Unicode ranges, preserves original comments, and reports recovery/orphans", () => {
    const f = setup(),
      a = f.propose(null);
    f.accept(a);
    const target: Target = {
      revision: a.revision,
      element: "intro",
      selector: {
        type: "text-range",
        start: 6,
        end: 7,
        unit: "unicode-code-point",
        exact: "🌍",
      },
    };
    const c = f.repo.comment({ target, body: "Change globe", author: "human" });
    expect(() =>
      f.repo.comment({
        target: {
          ...target,
          selector: {
            ...target.selector,
            type: "text-range",
            start: 6,
            end: 8,
            unit: "unicode-code-point",
            exact: "🌍",
          },
        },
        body: "bad",
        author: "agent",
      }),
    ).toThrow();
    f.write("Before Hello 🌍 world");
    const b = f.propose();
    expect(b.diff.anchorRisks).toEqual([
      { comment: c.id, status: "recovered" },
    ]);
    f.accept(b);
    expect(resolveTarget(f.repo.snapshot().index!, target).status).toBe(
      "recovered",
    );
    f.write("Gone", "replacement");
    const d = f.propose();
    expect(d.diff.anchorRisks[0]?.status).toBe("orphaned");
    f.repo.reply(c.id, "Updated in candidate", "agent");
    expect(f.repo.snapshot().state.comments[0]?.status).toBe("open");
    f.repo.resolveComment(c.id, f.repo.snapshot().stateId);
    expect(f.repo.snapshot().state.comments[0]?.target).toEqual(target);
  });
  it("keeps a changed comment target in the bounded element summary", () => {
    const beforeBody = Array.from(
        { length: 205 },
        (_, i) => `<p data-dstar-id="item-${i}">Before ${i}</p>`,
      ).join(""),
      afterBody = Array.from(
        { length: 205 },
        (_, i) => `<p data-dstar-id="item-${i}">After ${i}</p>`,
      ).join(""),
      before = new Map([
        [
          "document.html",
          Buffer.from(
            `<!doctype html><html><head><title>Before</title></head><body>${beforeBody}</body></html>`,
          ),
        ],
      ]),
      after = new Map([
        [
          "document.html",
          Buffer.from(
            `<!doctype html><html><head><title>After</title></head><body>${afterBody}</body></html>`,
          ),
        ],
      ]),
      diff = reviewDiff(before, after, [
        {
          id: "comment-late",
          target: {
            revision: `sha256:${"a".repeat(64)}`,
            element: "item-204",
            selector: { type: "element" },
          },
          body: "Review the last item",
          author: "human",
          createdAt: "2026-09-04T00:00:00.000Z",
          status: "open",
          replies: [],
        },
      ]);
    expect(diff.elementChangeCount).toBeGreaterThan(200);
    expect(diff.elements).toHaveLength(200);
    expect(diff.elements[0]?.id).toBe("item-204");
  });
  it("recovers an interrupted checkout using the authoritative old or new head", () => {
    const f = setup(),
      a = f.propose(null);
    f.accept(a);
    f.write("New");
    const b = f.propose();
    fs.writeFileSync(
      join(f.root, ".dstar/journal.json"),
      JSON.stringify({ paths: ["document.html", "styles.css"] }),
    );
    fs.copyFileSync(
      join(f.stage, "document.html"),
      join(f.root, "document.html"),
    );
    expect(f.repo.snapshot().revision).toBe(a.revision);
    expect(fs.readFileSync(join(f.root, "document.html"), "utf8")).toBe(html());
    f.accept(b);
    fs.writeFileSync(
      join(f.root, ".dstar/journal.json"),
      JSON.stringify({ paths: ["document.html", "styles.css"] }),
    );
    expect(f.repo.snapshot().revision).toBe(b.revision);
    expect(fs.existsSync(join(f.root, ".dstar/journal.json"))).toBe(false);
  });
  it("detects corrupt objects, out-of-band edits, unsafe paths and symlinks", () => {
    const f = setup(),
      a = f.propose(null);
    f.accept(a);
    fs.writeFileSync(join(f.root, "document.html"), "external edit");
    expect(() => f.repo.snapshot()).toThrow("outside DSTAR");
    fs.writeFileSync(join(f.root, "document.html"), html());
    const object = a.changes[0]!.storage!.object.slice(7);
    fs.writeFileSync(join(f.root, ".dstar/objects", object), "corrupt");
    expect(() => f.repo.snapshot()).toThrow("Corrupt history");
    fs.mkdirSync(join(f.stage, "styles"));
    fs.symlinkSync(
      join(f.stage, "document.html"),
      join(f.stage, "styles/evil.css"),
    );
    expect(() => readCandidate(f.stage)).toThrow("Symlink");
  });
  it("rejects scripts, remote dependencies, CSS escapes, invalid ids and missing assets", () => {
    for (const fragment of [
      "<script>alert(1)</script>",
      '<img src="https://example.com/a.png" alt="a" data-dstar-id="pic">',
      '<p onclick="bad()">x</p>',
      "<style>p{background:url(https://example.com/a)}</style>",
      "<style>p{color:r\\65 d}</style>",
      '<p data-dstar-id="intro">duplicate</p>',
    ]) {
      expect(() =>
        validateHtml(
          new Map([
            [
              "document.html",
              Buffer.from(html().replace("</main>", fragment + "</main>")),
            ],
            ["styles.css", Buffer.from("")],
          ]),
        ),
      ).toThrow();
    }
    expect(revision(new Map())).toBe(
      digest(JSON.stringify(["dstar-static-v1", []])),
    );
  });
});
