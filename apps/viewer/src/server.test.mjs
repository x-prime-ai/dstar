import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "@dstar/engine";
import { startViewer } from "./server.mjs";

const cleanup = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it("serves immutable isolated previews and requires human-session credentials for decisions", async () => {
  const temp = mkdtempSync(join(tmpdir(), "dstar-viewer-"));
  cleanup.push(() => rmSync(temp, { recursive: true, force: true }));
  const candidate = join(temp, "candidate"),
    root = join(temp, "doc");
  mkdirSync(candidate);
  writeFileSync(
    join(candidate, "document.html"),
    '<!doctype html><html><head><title>Preview</title></head><body><p data-dstar-id="intro">Hello 🌍</p></body></html>',
  );
  const engine = open(root),
    proposal = engine.propose({
      candidate,
      base: null,
      request: "Initial",
      author: "agent",
      key: "initial",
    });
  const viewer = await startViewer(root);
  cleanup.push(() => new Promise((resolve) => viewer.server.close(resolve)));
  const token = new URL(viewer.url).hash.slice(1),
    headers = { authorization: `Bearer ${token}` };
  const request = (path, extra = {}) =>
    fetch(viewer.origin + path, { headers, ...extra });
  expect((await fetch(viewer.origin + "/api/state")).status).toBe(401);
  const state = await (await request("/api/state")).json();
  expect(state.revision).toBeNull();
  const preview = await (await request(`/api/preview/${proposal.id}`)).json();
  const frame = await fetch(viewer.origin + preview.url);
  expect(frame.headers.get("content-security-policy")).toContain(
    "sandbox allow-scripts",
  );
  const rendered = await frame.text();
  expect(rendered).toContain("Hello 🌍");
  expect(rendered).not.toContain(token);
  expect(rendered).toContain("dstar-selection");
  expect(
    (
      await fetch(
        viewer.origin + preview.url.replace("document.html", "state.json"),
      )
    ).status,
  ).toBe(404);
  const body = JSON.stringify({
    revision: proposal.revision,
    stateId: state.stateId,
  });
  const endpoint = `/api/proposals/${proposal.id}/accept`;
  expect(
    (
      await request(endpoint, {
        method: "POST",
        body,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Origin: "http://evil.invalid",
        },
      })
    ).status,
  ).toBe(403);
  expect(engine.snapshot().revision).toBeNull();
  expect(
    (
      await request(endpoint, {
        method: "POST",
        body,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Origin: viewer.origin,
        },
      })
    ).status,
  ).toBe(200);
  expect(engine.snapshot().revision).toBe(proposal.revision);
  const comment = await request("/api/comments", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Origin: viewer.origin,
    },
    body: JSON.stringify({
      body: "A real comment",
      target: {
        revision: proposal.revision,
        element: "intro",
        selector: {
          type: "text-range",
          start: 6,
          end: 7,
          unit: "unicode-code-point",
          exact: "🌍",
        },
      },
    }),
  });
  expect(comment.status).toBe(201);
  expect(engine.snapshot().state.comments[0].author).toBe("human");
  expect(
    (
      await request(endpoint, {
        method: "POST",
        body,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Origin: viewer.origin,
        },
      })
    ).status,
  ).toBe(409);
});
