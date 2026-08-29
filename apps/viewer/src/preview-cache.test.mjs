import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { open } from "@dstar/engine";
import { startViewer } from "./server.mjs";
import { createPreviewCache } from "./preview-cache.mjs";

const opened = vi.hoisted(() => []);
vi.mock("@dstar/engine", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    open(...args) {
      const engine = actual.open(...args);
      engine.snapshot = vi.fn(engine.snapshot);
      opened.push(engine.snapshot);
      return engine;
    },
  };
});
const cleanup = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  opened.length = 0;
});
const snapshot = (text) => ({
  revision: text,
  files: new Map([["document.html", Buffer.from(text)]]),
  state: { comments: ["must not be cached"] },
});

it("bounds preview memory, evicts oldest entries and does not retain review metadata", () => {
  const cache = createPreviewCache({ maxBytes: 10, maxEntries: 3 });
  cache.set("first", snapshot("12345"));
  cache.set("second", snapshot("67890"));
  expect(cache.get("first")).not.toHaveProperty("state");
  cache.set("third", snapshot("abcde"));
  expect(cache.get("first")).toBeUndefined();
  expect(cache.get("second").revision).toBe("67890");
  expect(() => cache.set("too-big", snapshot("x".repeat(11)))).toThrow(
    "cache limit",
  );
  expect(cache.get("third").revision).toBe("abcde");
  cache.clear();
  expect(cache.get("third")).toBeUndefined();
  cache.set("fresh", snapshot("0123456789"));
  expect(cache.get("fresh").files.size).toBe(1);
});

it("bounds capability count and accounts correctly for replacement", () => {
  const cache = createPreviewCache({ maxBytes: 10, maxEntries: 2 });
  cache.set("first", snapshot("12345"));
  cache.set("first", snapshot("a"));
  cache.set("second", snapshot("123456789"));
  expect(cache.get("first").revision).toBe("a");
  cache.set("third", snapshot(""));
  expect(cache.get("first")).toBeUndefined();
  expect(cache.get("second")).toBeDefined();
  expect(cache.get("third")).toBeDefined();
});

it("uses one verified preview for HTML, CSS and images with 20 comments while decisions stay fresh", async () => {
  const temp = mkdtempSync(join(tmpdir(), "dstar-preview-cache-"));
  cleanup.push(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "doc"),
    candidate = join(temp, "candidate");
  mkdirSync(join(candidate, "assets"), { recursive: true });
  const html =
    '<!doctype html><html><head><title>Preview</title><link rel="stylesheet" href="styles.css"></head><body><p data-dstar-id="intro">Hello</p><img data-dstar-id="one" alt="One" src="assets/one.gif"><img data-dstar-id="two" alt="Two" src="assets/two.gif"></body></html>';
  const css = "body{color:#123456}";
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    "base64",
  );
  writeFileSync(join(candidate, "document.html"), html);
  writeFileSync(join(candidate, "styles.css"), css);
  for (const name of ["one", "two"])
    writeFileSync(join(candidate, `assets/${name}.gif`), gif);
  const engine = open(root);
  const p = engine.propose({
    candidate,
    base: null,
    request: "Preview",
    author: "agent",
    key: "initial",
  });
  const comment = () =>
    engine.comment({
      target: {
        revision: p.revision,
        element: "intro",
        selector: { type: "element" },
      },
      body: "Please clarify",
      author: "human",
    });
  for (let i = 0; i < 20; i++) comment();
  const before = engine.snapshot();
  const viewer = await startViewer(root);
  cleanup.push(() => new Promise((resolve) => viewer.server.close(resolve)));
  const viewerSnapshot = opened.at(-1);
  viewerSnapshot.mockClear();
  const token = new URL(viewer.url).hash.slice(1);
  const get = (path) =>
    fetch(viewer.origin + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
  const accept = (stateId) =>
    fetch(`${viewer.origin}/api/proposals/${p.id}/accept`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: viewer.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ revision: p.revision, stateId }),
    });
  const preview = await (await get(`/api/preview/${p.id}`)).json();
  expect(viewerSnapshot).toHaveBeenCalledTimes(1);
  expect(viewerSnapshot).toHaveBeenCalledWith(p.id);
  const frame = await fetch(viewer.origin + preview.url);
  expect(frame.status).toBe(200);
  expect(frame.headers.get("content-security-policy")).toContain(
    "sandbox allow-scripts",
  );
  expect(await frame.text()).toContain(html);
  for (const path of ["styles.css", "assets/one.gif", "assets/two.gif"]) {
    const resource = await fetch(
      viewer.origin + preview.url.replace("document.html", path),
    );
    expect(resource.status).toBe(200);
    expect(Buffer.from(await resource.arrayBuffer())).toEqual(
      path === "styles.css" ? Buffer.from(css) : gif,
    );
  }
  comment();
  expect((await fetch(viewer.origin + preview.url)).status).toBe(200);
  expect(viewerSnapshot).toHaveBeenCalledTimes(1);
  const current = await (await get("/api/state")).json();
  expect(current.state.comments).toHaveLength(21);
  expect(current.stateId).not.toBe(before.stateId);
  expect((await accept(before.stateId)).status).toBe(409);

  // An issued preview may keep its verified bytes, but it cannot authorize a
  // decision or make a fresh preview bypass damaged on-disk history.
  const hash = p.changes
    .find((c) => c.path === "document.html")
    .storage.object.slice(7);
  const objectPath = join(root, ".dstar/objects", hash),
    bytes = readFileSync(objectPath);
  writeFileSync(objectPath, "corrupt");
  expect(await (await fetch(viewer.origin + preview.url)).text()).toContain(
    html,
  );
  expect((await get(`/api/preview/${p.id}`)).status).toBe(409);
  expect((await accept(current.stateId)).status).toBe(409);
  writeFileSync(objectPath, bytes);
  expect((await accept(current.stateId)).status).toBe(200);
  expect((await (await get("/api/state")).json()).revision).toBe(p.revision);
});
