import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Repository } from "./repository.js";
import { MetadataStore } from "./metadata.js";
import { digest } from "./delta.js";
import type { Proposal, State, Target } from "./types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    openSync: vi.fn(actual.openSync),
  };
});
const temporary: string[] = [];
const originalRename = vi.mocked(fs.renameSync).getMockImplementation()!;
const originalOpen = vi.mocked(fs.openSync).getMockImplementation()!;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.mocked(fs.renameSync).mockImplementation(originalRename);
  vi.mocked(fs.openSync).mockImplementation(originalOpen);
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
const html = (text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Storage</title><link rel="stylesheet" href="styles.css"></head><body><p data-dstar-id="intro">${text}</p></body></html>`;
function setup() {
  const temp = fs.mkdtempSync(join(tmpdir(), "dstar-storage-"));
  temporary.push(temp);
  const stage = join(temp, "stage"),
    root = join(temp, "doc");
  fs.mkdirSync(stage);
  fs.writeFileSync(join(stage, "styles.css"), "body{color:#123456}");
  fs.writeFileSync(join(stage, "document.html"), html("First"));
  const repo = new Repository(root);
  const propose = (base: string | null, text = "First") => {
    fs.writeFileSync(join(stage, "document.html"), html(text));
    return repo.propose({
      candidate: stage,
      base,
      author: "agent",
      request: "Review",
      key: randomUUID(),
    });
  };
  const accept = (p: Proposal) =>
    repo.decide(p.id, "accept", p.revision, repo.snapshot().stateId, "human");
  const p = propose(null);
  const target: Target = {
    revision: p.revision,
    element: "intro",
    selector: { type: "element" },
  };
  const comment = () =>
    repo.comment({ target, body: "Please revise", author: "human" });
  return { temp, root, repo, propose, accept, p, comment };
}
function renamed(): string[] {
  return vi
    .mocked(fs.renameSync)
    .mock.calls.map(([, destination]) => String(destination));
}
function failSwap(path: string, when: "before" | "after"): void {
  let failed = false;
  vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
    if (!failed && String(destination) === path) {
      failed = true;
      if (when === "after") originalRename(source, destination);
      throw new Error("Injected storage failure");
    }
    return originalRename(source, destination);
  });
}
function legacy(f: ReturnType<typeof setup>): State {
  const state = f.repo.load();
  fs.writeFileSync(join(f.repo.meta, "state.json"), JSON.stringify(state));
  for (const name of ["comments", "proposals", "revisionRequests"])
    fs.rmSync(join(f.repo.meta, name), { recursive: true, force: true });
  return state;
}

describe("directory metadata records", () => {
  it("keeps a small root and preserves record order and the complete inspect view", () => {
    const f = setup();
    const a = f.comment(),
      b = f.comment();
    f.repo.reply(a.id, "Working on it", "agent");
    const raw = fs.readFileSync(join(f.repo.meta, "state.json"), "utf8");
    expect(Buffer.byteLength(raw)).toBeLessThan(512);
    expect(JSON.parse(raw)).toMatchObject({
      storage: "records-v1",
      proposalCount: 1,
      commentCount: 2,
    });
    expect(JSON.parse(raw)).not.toHaveProperty("proposals");
    expect(JSON.parse(raw)).not.toHaveProperty("comments");
    expect(
      JSON.parse(
        fs.readFileSync(join(f.repo.meta, "proposals/00000000.json"), "utf8"),
      ),
    ).toEqual(f.p);
    const s = new Repository(f.root).snapshot();
    expect(s.state.comments.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(s.state.comments[0]!.replies).toHaveLength(1);
    expect(s.stateId).toBe(digest(JSON.stringify(s.state)));
  });

  it("stores revision requests as a third records-v1 collection", () => {
    const f = setup();
    f.accept(f.p);
    const request = f.repo.createRevisionRequest({
      base: f.p.revision,
      instruction: "Revise the whole document",
      requester: "owner",
      key: "stored-request",
    });
    const header = JSON.parse(
      fs.readFileSync(join(f.repo.meta, "state.json"), "utf8"),
    );
    expect(header).toMatchObject({ revisionRequestCount: 1 });
    expect(
      JSON.parse(
        fs.readFileSync(
          join(f.repo.meta, "revisionRequests/00000000.json"),
          "utf8",
        ),
      ),
    ).toEqual(request);
    vi.clearAllMocks();
    f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "host-attempt",
    });
    expect(renamed()).toEqual([
      join(f.repo.meta, "metadata-journal.json"),
      join(f.repo.meta, "revisionRequests/00000000.json"),
      join(f.repo.meta, "state.json"),
    ]);
  });

  it("reads the original two-collection records-v1 header as no requests", () => {
    const f = setup(),
      path = join(f.repo.meta, "state.json"),
      header = JSON.parse(fs.readFileSync(path, "utf8"));
    delete header.revisionRequestCount;
    fs.writeFileSync(path, JSON.stringify(header));
    const reopened = new Repository(f.root).snapshot();
    expect(reopened.state.revisionRequests).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path, "utf8"))).not.toHaveProperty(
      "revisionRequestCount",
    );
  });

  it("reads a legacy monolithic state with no revision request field", () => {
    const f = setup(),
      path = join(f.repo.meta, "state.json"),
      state = f.repo.load(),
      legacyState = JSON.parse(JSON.stringify(state));
    delete legacyState.revisionRequests;
    fs.writeFileSync(path, JSON.stringify(legacyState));
    for (const name of ["comments", "proposals", "revisionRequests"])
      fs.rmSync(join(f.repo.meta, name), { recursive: true, force: true });
    const bytes = fs.readFileSync(path),
      reopened = new Repository(f.root).snapshot();
    expect(reopened.state.revisionRequests).toEqual([]);
    expect(fs.readFileSync(path)).toEqual(bytes);
  });

  it("recovers an interrupted revision request state update", () => {
    const f = setup();
    f.accept(f.p);
    const request = f.repo.createRevisionRequest({
        base: f.p.revision,
        instruction: "Retry safely",
        requester: "owner",
        key: "recover-request",
      }),
      before = f.repo.snapshot();
    failSwap(join(f.repo.meta, "state.json"), "before");
    expect(() =>
      f.repo.updateRevisionRequest(request.id, {
        status: "running",
        attemptId: "recover-attempt",
      }),
    ).toThrow("Injected storage failure");
    vi.mocked(fs.renameSync).mockImplementation(originalRename);
    const recovered = new Repository(f.root).snapshot();
    expect(recovered.stateId).toBe(before.stateId);
    expect(recovered.state.revisionRequests[0]).toMatchObject({
      status: "submitted",
      attempt: 0,
    });
    f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "recover-attempt",
    });
    expect(f.repo.snapshot().state.revisionRequests[0]).toMatchObject({
      status: "running",
      attempt: 1,
    });
  });

  it("only rewrites the changed thread, undo journal and small header on reply", () => {
    const f = setup(),
      a = f.comment();
    f.comment();
    vi.clearAllMocks();
    f.repo.reply(a.id, "Updated", "agent");
    expect(renamed()).toEqual([
      join(f.repo.meta, "metadata-journal.json"),
      join(f.repo.meta, "comments/00000000.json"),
      join(f.repo.meta, "state.json"),
    ]);
    expect(fs.existsSync(join(f.repo.meta, "metadata-journal.json"))).toBe(
      false,
    );
  });

  it("does not rewrite unchanged checkout files on acceptance", () => {
    const f = setup();
    f.accept(f.p);
    const next = f.propose(f.p.revision, "Changed");
    vi.clearAllMocks();
    f.accept(next);
    expect(renamed()).toContain(join(f.repo.root, "document.html"));
    expect(renamed()).not.toContain(join(f.repo.root, "styles.css"));
    expect(fs.readFileSync(join(f.root, "styles.css"), "utf8")).toBe(
      "body{color:#123456}",
    );
  });

  it("reads each head history object once per snapshot and still detects later corruption", () => {
    const f = setup();
    f.accept(f.p);
    vi.clearAllMocks();
    const first = f.repo.snapshot();
    const objects = vi
      .mocked(fs.readFileSync)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => path.includes("/.dstar/objects/"));
    expect(objects).toHaveLength(f.p.changes.length);
    first.files.get("document.html")!.fill(0);
    expect(f.repo.snapshot().files.get("document.html")!.toString()).toBe(
      html("First"),
    );
    fs.writeFileSync(objects[0]!, "broken");
    expect(() => f.repo.snapshot()).toThrow("Corrupt history");
  });

  it("leaves legacy metadata untouched on reads and converts it on a real write", () => {
    const f = setup();
    f.accept(f.p);
    const c = f.comment();
    const before = legacy(f);
    const bytes = fs.readFileSync(join(f.repo.meta, "state.json"));
    expect(new Repository(f.root).snapshot().state).toEqual(before);
    expect(fs.readFileSync(join(f.repo.meta, "state.json"))).toEqual(bytes);
    f.repo.reply(c.id, "Migration", "agent");
    const after = new Repository(f.root).snapshot();
    expect(after.revision).toBe(f.p.revision);
    expect(after.state.proposals).toEqual(before.proposals);
    expect(after.state.comments[0]!.replies[0]!.body).toBe("Migration");
    expect(after.state.generation).toBe(before.generation + 1);
    expect(
      JSON.parse(fs.readFileSync(join(f.repo.meta, "state.json"), "utf8"))
        .storage,
    ).toBe("records-v1");
  });

  it("does not convert legacy metadata for an idempotent proposal retry", () => {
    const f = setup();
    legacy(f);
    const before = fs.readFileSync(join(f.repo.meta, "state.json"));
    f.repo.propose({
      candidate: join(f.temp, "stage"),
      base: null,
      author: f.p.author,
      request: f.p.request,
      key: f.p.key,
    });
    expect(fs.readFileSync(join(f.repo.meta, "state.json"))).toEqual(before);
    expect(fs.existsSync(join(f.repo.meta, "proposals"))).toBe(false);
  });

  it("reopens a copied bundle with accepted, rejected and pending versions and comments", () => {
    const f = setup();
    f.accept(f.p);
    const c = f.comment();
    f.repo.reply(c.id, "Preserve me", "agent");
    const rejected = f.propose(f.p.revision, "Rejected");
    f.repo.decide(
      rejected.id,
      "reject",
      rejected.revision,
      f.repo.snapshot().stateId,
      "human",
    );
    const pending = f.propose(f.p.revision, "Pending");
    const before = f.repo.snapshot();
    const copy = join(f.temp, "portable-copy");
    fs.cpSync(f.root, copy, { recursive: true });
    const reopened = new Repository(copy);
    expect(reopened.snapshot()).toEqual(before);
    expect(
      reopened.snapshot(rejected.id).files.get("document.html")!.toString(),
    ).toBe(html("Rejected"));
    expect(
      reopened.snapshot(pending.id).files.get("document.html")!.toString(),
    ).toBe(html("Pending"));
    expect(reopened.snapshot().state.comments[0]!.replies[0]!.body).toBe(
      "Preserve me",
    );
  });

  it.each(["before", "after"] as const)(
    "keeps records unchanged if preparing the undo journal fails %s rename",
    (when) => {
      const f = setup(),
        c = f.comment();
      const before = f.repo.snapshot();
      failSwap(join(f.repo.meta, "metadata-journal.json"), when);
      expect(() => f.repo.reply(c.id, "Crash", "agent")).toThrow(
        "Injected storage failure",
      );
      vi.mocked(fs.renameSync).mockImplementation(originalRename);
      expect(new Repository(f.root).snapshot()).toEqual(before);
    },
  );

  it("does not prepare a journal for an unsafe new record directory", () => {
    const f = setup();
    fs.symlinkSync(f.temp, join(f.repo.meta, "comments"));
    expect(() => f.comment()).toThrow("Symlinks");
    expect(fs.existsSync(join(f.repo.meta, "metadata-journal.json"))).toBe(
      false,
    );
  });

  it("rejects record reordering before starting a metadata write", () => {
    const f = setup();
    f.comment();
    f.comment();
    const store = new MetadataStore(f.repo.meta),
      state = store.load();
    state.comments.reverse();
    expect(() => store.save(state)).toThrow("identities cannot be reordered");
    expect(fs.existsSync(join(f.repo.meta, "metadata-journal.json"))).toBe(
      false,
    );
  });

  for (const when of ["before", "after"] as const) {
    it(`recovers reply ${when} header commit without a partial thread`, () => {
      const f = setup(),
        c = f.comment();
      const previous = f.repo.snapshot();
      failSwap(join(f.repo.meta, "state.json"), when);
      expect(() => f.repo.reply(c.id, "Once", "agent", "retry")).toThrow(
        "Injected storage failure",
      );
      vi.mocked(fs.renameSync).mockImplementation(originalRename);
      const s = new Repository(f.root).snapshot();
      expect(s.state.comments[0]!.replies).toHaveLength(
        when === "before" ? 0 : 1,
      );
      expect(s.state.generation).toBe(
        previous.state.generation + (when === "before" ? 0 : 1),
      );
      f.repo.reply(c.id, "Once", "agent", "retry");
      expect(f.repo.snapshot().state.comments[0]!.replies).toHaveLength(1);
      expect(fs.existsSync(join(f.repo.meta, "metadata-journal.json"))).toBe(
        false,
      );
    });

    it(`recovers legacy conversion ${when} header commit with exact history`, () => {
      const f = setup();
      f.accept(f.p);
      const c = f.comment();
      const before = legacy(f);
      failSwap(join(f.repo.meta, "state.json"), when);
      expect(() => f.repo.reply(c.id, "Converted", "agent")).toThrow(
        "Injected storage failure",
      );
      vi.mocked(fs.renameSync).mockImplementation(originalRename);
      const s = new Repository(f.root).snapshot();
      expect(s.revision).toBe(f.p.revision);
      expect(s.state.proposals).toEqual(before.proposals);
      if (when === "before") {
        expect(s.state).toEqual(before);
        expect(fs.readdirSync(join(f.repo.meta, "proposals"))).toEqual([]);
        expect(fs.readdirSync(join(f.repo.meta, "comments"))).toEqual([]);
      } else expect(s.state.comments[0]!.replies).toHaveLength(1);
    });
  }

  it("rolls back a partially written migration and permits retry", () => {
    const f = setup();
    f.comment();
    const before = legacy(f);
    failSwap(join(f.repo.meta, "comments/00000000.json"), "before");
    expect(() => f.comment()).toThrow("Injected storage failure");
    vi.mocked(fs.renameSync).mockImplementation(originalRename);
    expect(new Repository(f.root).snapshot().state).toEqual(before);
    f.comment();
    expect(f.repo.snapshot().state.comments).toHaveLength(2);
  });

  it("removes only newly appended records on rollback", () => {
    const f = setup();
    const before = f.repo.snapshot();
    const unrelated = join(f.repo.meta, "comments/keep.txt");
    fs.mkdirSync(join(f.repo.meta, "comments"));
    fs.writeFileSync(unrelated, "keep");
    failSwap(join(f.repo.meta, "state.json"), "before");
    expect(() => f.comment()).toThrow("Injected storage failure");
    vi.mocked(fs.renameSync).mockImplementation(originalRename);
    expect(new Repository(f.root).snapshot().stateId).toBe(before.stateId);
    expect(fs.existsSync(join(f.repo.meta, "comments/00000000.json"))).toBe(
      false,
    );
    expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
  });

  it("can resume interrupted metadata rollback", () => {
    const f = setup(),
      c = f.comment();
    const before = f.repo.snapshot().stateId;
    failSwap(join(f.repo.meta, "state.json"), "before");
    expect(() => f.repo.reply(c.id, "Crash", "agent")).toThrow();
    failSwap(join(f.repo.meta, "comments/00000000.json"), "after");
    expect(() => new Repository(f.root).snapshot()).toThrow(
      "Injected storage failure",
    );
    vi.mocked(fs.renameSync).mockImplementation(originalRename);
    expect(new Repository(f.root).snapshot().stateId).toBe(before);
  });

  it("reopens unchanged records without another allocation while disk space is still exhausted", () => {
    const f = setup();
    f.accept(f.p);
    const c = f.comment(),
      before = f.repo.snapshot();
    const record = join(f.repo.meta, "comments/00000000.json");
    const bytes = fs.readFileSync(record);
    vi.mocked(fs.openSync).mockImplementation((path, flags, mode) => {
      if (String(path).startsWith(join(f.repo.meta, "comments/.write-")))
        throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      return originalOpen(path, flags, mode);
    });
    // Keep the failure active during recovery, rather than failing just once.
    expect(() => f.repo.reply(c.id, "Update", "agent")).toThrow("Disk full");
    expect(fs.readFileSync(record)).toEqual(bytes);
    vi.mocked(fs.renameSync).mockClear();
    expect(new Repository(f.root).snapshot()).toEqual(before);
    expect(renamed()).not.toContain(record);
    expect(fs.existsSync(join(f.repo.meta, "metadata-journal.json"))).toBe(
      false,
    );
    const out = join(f.temp, "export");
    f.repo.export(out);
    expect(fs.readFileSync(join(out, "document.html"))).toEqual(
      before.files.get("document.html"),
    );
  });

  it.each(["missing", "symlink", "corrupt"])(
    "fails closed for %s metadata records",
    (kind) => {
      const f = setup();
      const record = join(f.repo.meta, "proposals/00000000.json");
      fs.unlinkSync(record);
      if (kind === "symlink")
        fs.symlinkSync(join(f.repo.meta, "state.json"), record);
      if (kind === "corrupt") fs.writeFileSync(record, "{}");
      expect(() => new Repository(f.root).snapshot()).toThrow();
    },
  );

  it("rejects unsupported storage, excessive counts and unknown record collisions", () => {
    const f = setup(),
      path = join(f.repo.meta, "state.json");
    const header = JSON.parse(fs.readFileSync(path, "utf8"));
    for (const change of [
      { storage: "future" },
      { proposalCount: 10001 },
      { commentCount: -1 },
      { proposalCount: 0.5 },
    ]) {
      fs.writeFileSync(path, JSON.stringify({ ...header, ...change }));
      expect(() => f.repo.snapshot()).toThrow();
    }
    fs.writeFileSync(path, JSON.stringify(header));
    fs.mkdirSync(join(f.repo.meta, "comments"));
    const collision = join(f.repo.meta, "comments/00000000.json");
    fs.writeFileSync(collision, "untracked");
    expect(() => f.comment()).toThrow("Untracked metadata record");
    expect(fs.readFileSync(collision, "utf8")).toBe("untracked");
  });

  it("rejects a recovery journal's unsafe destinations before touching records", () => {
    const f = setup(),
      c = f.comment();
    failSwap(join(f.repo.meta, "state.json"), "before");
    expect(() => f.repo.reply(c.id, "Crash", "agent")).toThrow();
    vi.mocked(fs.renameSync).mockImplementation(originalRename);
    const path = join(f.repo.meta, "metadata-journal.json");
    const journal = JSON.parse(fs.readFileSync(path, "utf8"));
    journal.records.push({ collection: "../objects", index: 0, before: null });
    fs.writeFileSync(path, JSON.stringify(journal));
    vi.clearAllMocks();
    expect(() => new Repository(f.root).snapshot()).toThrow(
      "Invalid metadata record path",
    );
    expect(renamed()).toEqual([]);
    expect(fs.existsSync(path)).toBe(true);
  });

  it("keeps a reply write small with 50 ordinary comment threads", () => {
    const f = setup(),
      c = f.comment();
    const state = legacy(f);
    state.comments = Array.from({ length: 50 }, () => ({
      ...c,
      id: randomUUID(),
      body: "Please clarify the assumptions in this paragraph. ".repeat(4),
    }));
    fs.writeFileSync(join(f.repo.meta, "state.json"), JSON.stringify(state));
    const store = new MetadataStore(f.repo.meta);
    store.save(store.load());
    const loaded = store.load();
    loaded.comments[31]!.replies.push({
      id: randomUUID(),
      body: "Small reply",
      author: "agent",
      createdAt: new Date().toISOString(),
    });
    vi.clearAllMocks();
    store.save(loaded);
    const written = vi
      .mocked(fs.writeFileSync)
      .mock.calls.reduce(
        (sum, [, bytes]) => sum + Buffer.byteLength(bytes as string | Buffer),
        0,
      );
    expect(written).toBeLessThan(
      Buffer.byteLength(JSON.stringify(loaded)) / 10,
    );
    expect(renamed()).toHaveLength(3);
  });
});
