import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisions } from "@dstar/engine/decisions";
import { open } from "@dstar/engine";
import { afterEach, describe, expect, it } from "vitest";

import { workspaceStore } from "./store.mjs";

const cleanup = [];
afterEach(() => {
  for (const path of cleanup.splice(0).reverse()) {
    if (existsSync(join(path, "seed.dstar")))
      chmodSync(join(path, "seed.dstar"), 0o700);
    rmSync(path, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dstar-workspace-store-"));
  cleanup.push(root);
  const candidate = join(root, "candidate");
  const seedRoot = join(root, "seed.dstar");
  mkdirSync(candidate);
  writeFileSync(
    join(candidate, "document.html"),
    '<!doctype html><html><head><title>Seed</title></head><body><p data-dstar-id="intro">Seed text</p></body></html>',
  );
  const engine = open(seedRoot);
  const proposal = engine.propose({
    candidate,
    base: null,
    request: "Create the read-only seed",
    author: "seed-builder",
    key: randomUUID(),
  });
  const state = engine.snapshot();
  decisions(seedRoot).decide(
    proposal.id,
    "accept",
    proposal.revision,
    state.stateId,
    "seed-builder",
  );
  return { root, seedRoot, proposal };
}

describe("persistent workspace store", () => {
  it("copies a read-only seed into isolated generations without mutating it", async () => {
    const { root, seedRoot } = fixture();
    const before = open(seedRoot).snapshot().stateId;
    chmodSync(seedRoot, 0o555);
    const store = workspaceStore({
      root: join(root, "runtime"),
      seedRoot,
    });
    const [first, second] = await Promise.all([store.create(), store.create()]);
    expect(first.metadata.id).not.toBe(second.metadata.id);
    expect(first.credentials.viewerOptions).toMatchObject({
      ownerToken: first.credentials.ownerToken,
      ownerDisplayName: "Workspace Owner",
      reviewerDisplayName: "Workspace Reviewer",
    });
    expect(first.credentials.viewerOptions.reviewerToken).toMatch(
      /^[A-Za-z0-9_-]{48,256}$/,
    );
    expect(first.credentials.viewerOptions.reviewerToken).not.toBe(
      first.credentials.ownerToken,
    );
    expect(store.load(first.metadata.id).packageRoot).not.toBe(
      store.load(second.metadata.id).packageRoot,
    );
    expect(open(seedRoot).snapshot().stateId).toBe(before);
    const firstState = open(store.load(first.metadata.id).packageRoot);
    firstState.comment({
      target: {
        revision: firstState.snapshot().revision,
        element: "intro",
        selector: {
          type: "text-range",
          start: 0,
          end: 4,
          unit: "unicode-code-point",
          exact: "Seed",
        },
      },
      body: "Only workspace one",
      author: "reviewer",
    });
    expect(firstState.snapshot().state.comments).toHaveLength(1);
    expect(
      open(store.load(second.metadata.id).packageRoot).snapshot().state
        .comments,
    ).toHaveLength(0);
  });

  it("serializes concurrent create/reset and rotates the complete session config", async () => {
    const { root, seedRoot } = fixture();
    let token = 0;
    const store = workspaceStore({
      root: join(root, "runtime"),
      seedRoot,
      maxWorkspaces: 2,
      randomToken: () => `${String(++token).padStart(48, "a")}`,
      createSessionConfig: ({ ownerToken, randomToken }) => ({
        ownerToken,
        viewerOptions: {
          ownerToken,
          reviewerToken: randomToken(),
        },
      }),
    });
    const created = await Promise.allSettled([
      store.create(),
      store.create(),
      store.create(),
    ]);
    expect(
      created.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(
      created.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const first = created.find((result) => result.status === "fulfilled").value;
    const oldToken = first.credentials.ownerToken;
    const reset = await store.reset(first.metadata.id, oldToken);
    expect(reset.metadata.generation).toBe(2);
    expect(reset.credentials.ownerToken).not.toBe(oldToken);
    expect(reset.credentials.viewerOptions.reviewerToken).not.toBe(
      first.credentials.viewerOptions.reviewerToken,
    );
    expect(store.authorize(first.metadata.id, oldToken)).toBe(false);
    await expect(store.reset(first.metadata.id, oldToken)).rejects.toThrow(
      "owner authorization",
    );
  });

  it("enforces disk limits, TTL cleanup inputs, and rejects path-selected ids", async () => {
    const { root, seedRoot } = fixture();
    let clock = Date.parse("2026-08-29T00:00:00Z");
    const store = workspaceStore({
      root: join(root, "runtime"),
      seedRoot,
      maxTotalBytes: 1,
      ttlMs: 1000,
      now: () => clock,
    });
    await expect(store.create()).rejects.toThrow("disk limit");

    const usable = workspaceStore({
      root: join(root, "runtime-ttl"),
      seedRoot,
      ttlMs: 1000,
      now: () => clock,
    });
    const created = await usable.create();
    expect(usable.expired()).toEqual([]);
    clock += 1001;
    expect(usable.expired()).toEqual([created.metadata.id]);
    await usable.remove(created.metadata.id);
    expect(usable.list()).toEqual([]);
    expect(() => usable.load("../../seed.dstar")).toThrow(
      "Invalid workspace id",
    );
  });
});
