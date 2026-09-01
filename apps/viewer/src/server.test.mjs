import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, revision } from "@dstar/engine";
import { AGENT_LIMITS, decodeCandidate, agentRoute } from "./agent-api.mjs";
import { startViewer } from "./server.mjs";
import { viewerConfigFromEnv } from "./runtime-config.mjs";

const cleanup = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture(text = "Hello 🌍") {
  const temp = mkdtempSync(join(tmpdir(), "dstar-viewer-"));
  cleanup.push(() => rmSync(temp, { recursive: true, force: true }));
  const candidate = join(temp, "candidate"),
    root = join(temp, "doc");
  mkdirSync(candidate);
  writeFileSync(
    join(candidate, "document.html"),
    `<!doctype html><html><head><title>Preview</title></head><body><p data-dstar-id="intro">${text}</p></body></html>`,
  );
  const engine = open(root),
    proposal = engine.propose({
      candidate,
      base: null,
      request: "Initial",
      author: "agent",
      key: "initial",
    });
  return { temp, root, candidate, engine, proposal };
}
const close = (server) => new Promise((resolve) => server.close(resolve));
async function start(root, port = 0, options = {}) {
  const viewer = await startViewer(root, port, options);
  cleanup.push(() => close(viewer.server));
  return viewer;
}
function wire(viewer, path, { headers = {}, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: viewer.server.address().port,
        // Reconnect after restart instead of reusing a just-closed pooled socket.
        agent: false,
        path,
        method,
        headers: Array.isArray(headers)
          ? headers
          : { Host: new URL(viewer.origin).host, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
            json: () => JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

it("serves immutable isolated previews and requires session credentials for decisions", async () => {
  const { root, engine, proposal } = fixture();
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
  expect(engine.snapshot().state.comments[0].author).toEqual({
    id: "owner",
    displayName: "Owner",
    role: "owner",
  });
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

it("does not expose the retired manual suggestion endpoint", async () => {
  const { root, proposal } = fixture(),
    viewer = await startViewer(root),
    token = new URL(viewer.url).hash.slice(1),
    headers = {
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: viewer.origin,
    },
    request = (path, body) =>
      fetch(viewer.origin + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
  cleanup.push(() => close(viewer.server));
  const response = await request("/api/suggestions", {
    target: { revision: proposal.revision },
    replacement: "world",
    key: "retired-suggestion",
  });
  expect(response.status).toBe(404);
});

it("uses a short-lived scoped handoff to return an agent draft", async () => {
  const { root, engine, proposal } = fixture(),
    viewer = await startViewer(root),
    ownerToken = new URL(viewer.url).hash.slice(1),
    scopedToken = "h".repeat(64),
    id = "11111111-1111-4111-8111-111111111111",
    target = {
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
    context = {
      review: {
        proposalId: proposal.id,
        showingBase: false,
        revision: proposal.revision,
        previewStatus: "ready",
      },
      selection: target,
      action: { kind: "comment", target, draft: "" },
    },
    ownerHeaders = {
      Authorization: `Bearer ${ownerToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    },
    scopedHeaders = {
      Authorization: `Bearer ${scopedToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    };
  cleanup.push(() => close(viewer.server));
  const created = await wire(viewer, "/api/handoffs", {
    headers: ownerHeaders,
    method: "POST",
    body: JSON.stringify({ id, accessToken: scopedToken, context }),
  });
  expect(created.status).toBe(201);
  expect(created.text).not.toContain(ownerToken);
  expect(created.text).not.toContain(scopedToken);
  expect(
    (await wire(viewer, "/api/state", { headers: scopedHeaders })).status,
  ).toBe(200);
  const toolContext = await wire(viewer, "/api/agent/context", {
    headers: scopedHeaders,
    method: "POST",
    body: JSON.stringify(context),
  });
  expect(toolContext.status).toBe(200);
  expect(toolContext.json().action).toMatchObject({
    kind: "comment",
    target,
  });
  const document = await wire(viewer, "/api/agent/document", {
    headers: scopedHeaders,
    method: "POST",
    body: JSON.stringify({ revision: proposal.revision }),
  });
  expect(document.status).toBe(200);
  expect(document.json().files[0].content).toContain("Hello 🌍");
  expect(
    (
      await wire(viewer, `/api/proposals/${proposal.id}/reject`, {
        headers: scopedHeaders,
        method: "POST",
        body: JSON.stringify({
          revision: proposal.revision,
          stateId: engine.snapshot().stateId,
        }),
      })
    ).status,
  ).toBe(403);
  const returned = await wire(viewer, `/api/handoffs/${id}/draft`, {
    headers: scopedHeaders,
    method: "POST",
    body: JSON.stringify({ kind: "comment", content: "Please clarify this" }),
  });
  expect(returned.status).toBe(200);
  const record = await wire(viewer, `/api/handoffs/${id}`, {
    headers: ownerHeaders,
  });
  expect(record.json().draft).toMatchObject({
    kind: "comment",
    content: "Please clarify this",
  });
  expect(
    (
      await wire(viewer, `/api/handoffs/${id}/revoke`, {
        headers: ownerHeaders,
        method: "POST",
        body: "{}",
      })
    ).status,
  ).toBe(200);
  expect(
    (await wire(viewer, "/api/state", { headers: scopedHeaders })).status,
  ).toBe(401);
});

it("binds an existing-comment handoff to an editable reply or linked pending proposal", async () => {
  const { root, engine, proposal } = fixture(),
    comment = engine.comment({
      target: {
        revision: proposal.revision,
        element: "intro",
        selector: { type: "element" },
      },
      body: "Make this greeting clearer",
      author: "human",
    }),
    viewer = await startViewer(root),
    ownerToken = new URL(viewer.url).hash.slice(1),
    scopedToken = "j".repeat(64),
    id = "33333333-3333-4333-8333-333333333333",
    context = {
      review: null,
      selection: null,
      action: {
        kind: "address-comment",
        commentId: comment.id,
        target: comment.target,
        draft: "",
      },
      focusedCommentId: comment.id,
    },
    ownerHeaders = {
      Authorization: `Bearer ${ownerToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    },
    scopedHeaders = {
      Authorization: `Bearer ${scopedToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    },
    post = (path, body, headers = scopedHeaders) =>
      wire(viewer, path, {
        headers,
        method: "POST",
        body: JSON.stringify(body),
      });
  cleanup.push(() => close(viewer.server));
  const created = await post(
    "/api/handoffs",
    { id, accessToken: scopedToken, context },
    ownerHeaders,
  );
  expect(created.status).toBe(201);
  expect(created.json().session.capabilities).toEqual([
    "read",
    "reply",
    "propose",
  ]);
  const read = await post("/api/agent/context", context);
  expect(read.status).toBe(200);
  expect(read.json()).toMatchObject({
    focusedComment: { id: comment.id, status: "open" },
    action: { kind: "address-comment", commentId: comment.id },
  });
  expect(
    (
      await post(`/api/handoffs/${id}/reply-draft`, {
        commentId: comment.id,
        body: "I prepared a linked proposal for your review.",
      })
    ).status,
  ).toBe(200);
  const returned = await wire(viewer, `/api/handoffs/${id}`, {
    headers: ownerHeaders,
  });
  expect(returned.json().replyDraft).toMatchObject({
    commentId: comment.id,
    body: "I prepared a linked proposal for your review.",
  });
  expect(
    (
      await post("/api/agent/reply", {
        commentId: comment.id,
        body: "Do not post this",
        key: "forbidden-direct-reply",
      })
    ).status,
  ).toBe(403);
  const request = {
    base: null,
    request: "Address the greeting comment",
    key: "address-comment-proposal",
    commentIds: [comment.id],
    files: candidateFiles("A clearer greeting"),
  };
  expect(
    (
      await post("/api/agent/proposals", {
        ...request,
        commentIds: ["44444444-4444-4444-8444-444444444444"],
      })
    ).status,
  ).toBe(403);
  const proposed = await post("/api/agent/proposals", request);
  expect(proposed.status).toBe(200);
  expect(proposed.json().proposal.motivatedBy).toEqual([comment.id]);
  expect(engine.snapshot().state.comments[0].status).toBe("open");
  expect((await post("/api/agent/context", context)).status).toBe(409);
  const linked = engine.snapshot().state.proposals.at(-1);
  const accepted = await post(
    `/api/proposals/${linked.id}/accept`,
    { revision: linked.revision, stateId: engine.snapshot().stateId },
    ownerHeaders,
  );
  expect(accepted.status).toBe(200);
  expect(engine.snapshot().state.comments[0].status).toBe("open");
});

it("resolves comment markers against the viewed revision without changing canonical files", async () => {
  const { root, candidate, engine, proposal } = fixture();
  const viewer = await start(root);
  const headers = {
    Authorization: `Bearer ${new URL(viewer.url).hash.slice(1)}`,
    Origin: viewer.origin,
    "Content-Type": "application/json",
  };
  await wire(viewer, `/api/proposals/${proposal.id}/accept`, {
    headers,
    method: "POST",
    body: JSON.stringify({
      revision: proposal.revision,
      stateId: engine.snapshot().stateId,
    }),
  });
  const comment = engine.comment({
    author: "human",
    body: "Keep the globe",
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
  });
  const original = readFileSync(join(candidate, "document.html"), "utf8");
  writeFileSync(
    join(candidate, "document.html"),
    original.replace("Hello 🌍", "Updated Hello 🌍"),
  );
  const updated = engine.propose({
    candidate,
    base: proposal.revision,
    request: "Update",
    author: "agent",
    key: "update",
  });
  const diffPath = `/api/diff/${updated.id}?file=document.html`;
  expect((await wire(viewer, diffPath)).status).toBe(401);
  expect(
    (
      await wire(viewer, diffPath, {
        headers: { ...headers, Origin: "https://evil.invalid" },
      })
    ).status,
  ).toBe(403);
  const diff = (await wire(viewer, diffPath, { headers })).json();
  expect(diff).toMatchObject({
    proposalId: updated.id,
    base: proposal.revision,
    revision: updated.revision,
    path: "document.html",
  });
  expect(diff.before.text).toBe(original);
  expect(diff.after.text).toBe(
    original.replace("Hello 🌍", "Updated Hello 🌍"),
  );
  expect(diff.elements[0]).toMatchObject({
    id: "intro",
    before: { text: "Hello 🌍" },
    after: { text: "Updated Hello 🌍" },
  });
  expect(
    (
      await wire(viewer, `/api/diff/${updated.id}?file=.dstar/state.json`, {
        headers,
      })
    ).status,
  ).toBe(404);
  const initialDiff = (
    await wire(viewer, `/api/diff/${proposal.id}?file=document.html`, {
      headers,
    })
  ).json();
  expect(initialDiff.base).toBeNull();
  expect(initialDiff.before.exists).toBe(false);
  const path = `/api/annotations/${updated.id}`;
  expect((await wire(viewer, path)).status).toBe(401);
  expect(
    (
      await wire(viewer, path, {
        headers: { ...headers, Origin: "https://evil.invalid" },
      })
    ).status,
  ).toBe(403);
  const before = (
    await wire(viewer, `/api/annotations/${proposal.id}`, { headers })
  ).json();
  const after = (await wire(viewer, path, { headers })).json();
  expect(before.revision).toBe(proposal.revision);
  expect(before.anchors[comment.id]).toEqual({
    status: "exact",
    start: 6,
    end: 7,
  });
  expect(after.revision).toBe(updated.revision);
  expect(after.stateId).toBe(engine.snapshot().stateId);
  expect(after.anchors[comment.id]).toEqual({
    status: "recovered",
    start: 14,
    end: 15,
  });
  expect(after.labels.intro).toBe("Updated Hello 🌍");
  writeFileSync(
    join(candidate, "document.html"),
    original.replace("Hello 🌍", "No globe"),
  );
  const removed = engine.propose({
    candidate,
    base: proposal.revision,
    request: "Remove globe",
    author: "agent",
    key: "remove",
  });
  const missing = (
    await wire(viewer, `/api/annotations/${removed.id}`, { headers })
  ).json();
  expect(missing.anchors[comment.id]).toEqual({ status: "orphaned" });
  expect(
    engine.snapshot(proposal.id).files.get("document.html").toString(),
  ).toBe(original);
});

it("uses only the configured external authority while preserving opaque-origin frame sandboxing", async () => {
  const { root, engine, proposal } = fixture();
  const token = "b".repeat(64),
    reviewerToken = "v".repeat(64),
    externalOrigin = "https://review.example.com:8443";
  const viewer = await start(root, 0, {
    host: "0.0.0.0",
    externalOrigin,
    token,
    reviewerToken,
  });
  expect(viewer.server.address().address).toBe("0.0.0.0");
  const headers = { Authorization: `Bearer ${token}` };
  expect(viewer.origin).toBe(externalOrigin);
  expect((await wire(viewer, "/api/state")).status).toBe(401);
  expect(
    (
      await wire(viewer, "/api/state", {
        headers: {
          ...headers,
          Host: `127.0.0.1:${viewer.server.address().port}`,
        },
      })
    ).status,
  ).toBe(403);
  const state = (await wire(viewer, "/api/state", { headers })).json();
  const reviewerHeaders = { Authorization: `Bearer ${reviewerToken}` },
    reviewerState = (
      await wire(viewer, "/api/state", {
        headers: { ...reviewerHeaders, Origin: externalOrigin },
      })
    ).json();
  expect(reviewerState.session.role).toBe("reviewer");
  expect(
    (
      await wire(viewer, `/api/proposals/${proposal.id}/accept`, {
        method: "POST",
        headers: {
          ...reviewerHeaders,
          Origin: externalOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revision: proposal.revision,
          stateId: reviewerState.stateId,
        }),
      })
    ).status,
  ).toBe(403);
  const preview = (
    await wire(viewer, `/api/preview/${proposal.id}`, { headers })
  ).json();
  const frame = await wire(viewer, preview.url, {
    headers: { Origin: "null" },
  });
  expect(frame.status).toBe(200);
  expect(frame.headers["content-security-policy"]).toContain(
    `style-src ${externalOrigin} 'unsafe-inline'`,
  );
  expect(frame.headers["content-security-policy"]).toContain(
    `frame-ancestors ${externalOrigin}`,
  );
  expect(frame.headers["content-security-policy"]).toContain(
    "sandbox allow-scripts",
  );
  expect(frame.headers["content-security-policy"]).not.toContain(
    "allow-same-origin",
  );
  expect(frame.text).toContain(`"origin":"${externalOrigin}"`);
  expect(frame.text).not.toContain(token);
  expect(frame.text).not.toContain(reviewerToken);
  const result = await wire(viewer, `/api/proposals/${proposal.id}/accept`, {
    method: "POST",
    headers: {
      ...headers,
      Origin: externalOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      revision: proposal.revision,
      stateId: state.stateId,
    }),
  });
  expect(result.status).toBe(200);
  expect(engine.snapshot().revision).toBe(proposal.revision);
});

it("rejects forwarded authority, duplicate sensitive headers and unsafe raw request targets", async () => {
  const { root } = fixture();
  const token = "c".repeat(64),
    viewer = await start(root, 0, {
      token,
      externalOrigin: "https://review.example.com",
    });
  const headers = { Authorization: `Bearer ${token}` };
  for (const extra of [
    { Host: "evil.example" },
    { Host: "review.example.com:443" },
    { Forwarded: "host=review.example.com;proto=https" },
    { "X-Forwarded-Host": "review.example.com" },
    { "X-Forwarded-Proto": "https" },
    { "X-Forwarded-For": "127.0.0.1" },
    { "X-Forwarded-Port": "443" },
    { "X-Forwarded-Prefix": "/" },
    { Origin: "null" },
    { Origin: "https://evil.example" },
    { Origin: "https://review.example.com/" },
  ])
    expect(
      (await wire(viewer, "/api/state", { headers: { ...headers, ...extra } }))
        .status,
    ).toBe(403);
  for (const path of [
    "https://review.example.com/api/state",
    "//review.example.com/api/state",
    "/frame/../api/state",
    "/frame/%2e%2e/api/state",
    "/api%2fstate",
    "/api%5cstate",
    "/api/%00state",
    "/api/%zz",
    "/api/state#x",
  ])
    expect((await wire(viewer, path, { headers })).status).toBe(403);
  for (const [name, value] of [
    ["Host", "review.example.com"],
    ["Origin", viewer.origin],
    ["Authorization", `Bearer ${token}`],
    ["Content-Type", "application/json"],
  ]) {
    const raw = [
      "Host",
      "review.example.com",
      "Authorization",
      `Bearer ${token}`,
    ];
    if (!["Host", "Authorization"].includes(name)) raw.push(name, value);
    raw.push(name, value);
    expect((await wire(viewer, "/api/state", { headers: raw })).status).toBe(
      403,
    );
  }
});

it("requires exact Origin and JSON for every mutation without accepting tokens from URLs or cookies", async () => {
  const { root, engine, proposal } = fixture();
  const viewer = await start(root),
    token = new URL(viewer.url).hash.slice(1);
  const state = engine.snapshot();
  const path = `/api/proposals/${proposal.id}/accept`,
    body = JSON.stringify({
      revision: proposal.revision,
      stateId: state.stateId,
    });
  for (const headers of [
    { "Content-Type": "application/json" },
    { Origin: "null", "Content-Type": "application/json" },
    { Origin: viewer.origin, "Content-Type": "text/plain" },
    {
      Origin: viewer.origin,
      "Content-Type": "application/json; charset=utf-8",
    },
    { Origin: viewer.origin },
  ])
    expect(
      (
        await wire(viewer, path, {
          method: "POST",
          body,
          headers: { Authorization: `Bearer ${token}`, ...headers },
        })
      ).status,
    ).toBe(403);
  for (const request of [
    { path: `/api/state?token=${token}` },
    { path: "/api/state", headers: { Cookie: `dstar-token=${token}` } },
  ])
    expect((await wire(viewer, request.path, request)).status).toBe(401);
  expect(engine.snapshot().stateId).toBe(state.stateId);
});

it("keeps roots, credentials and preview capabilities separate between configured instances", async () => {
  const a = fixture("First document"),
    b = fixture("Second document");
  const first = await start(a.root, 0, {
    token: "d".repeat(64),
    externalOrigin: "https://first.example.com",
  });
  const second = await start(b.root, 0, {
    token: "e".repeat(64),
    externalOrigin: "https://second.example.com",
  });
  const authA = { Authorization: `Bearer ${"d".repeat(64)}` },
    authB = { Authorization: `Bearer ${"e".repeat(64)}` };
  expect((await wire(second, "/api/state", { headers: authA })).status).toBe(
    401,
  );
  expect((await wire(first, "/api/state", { headers: authB })).status).toBe(
    401,
  );
  expect(
    (
      await wire(second, "/api/state", {
        headers: { ...authB, Host: "first.example.com" },
      })
    ).status,
  ).toBe(403);
  const preview = (
    await wire(first, `/api/preview/${a.proposal.id}`, { headers: authA })
  ).json();
  expect((await wire(second, preview.url)).status).toBe(404);
  expect(
    (await wire(second, `/api/preview/${a.proposal.id}`, { headers: authB }))
      .status,
  ).toBe(409);
  const state = (
    await wire(first, `/api/state?root=${encodeURIComponent(b.root)}`, {
      headers: authA,
    })
  ).json();
  expect(state.state.id).toBe(a.engine.snapshot().state.id);
  expect(
    (
      await wire(
        first,
        preview.url.replace("document.html", ".dstar/state.json"),
      )
    ).status,
  ).toBe(404);
  expect(
    (await wire(first, "/.dstar/state.json", { headers: authA })).status,
  ).toBe(401);
});

it("retains accepted versions, comments and pending work across restart; refreshes capabilities and credentials", async () => {
  const { root, temp, candidate, engine, proposal } = fixture();
  const tokenFile = join(temp, "credential");
  writeFileSync(tokenFile, "f".repeat(64));
  const options = { tokenFile, externalOrigin: "https://review.example.com" };
  const first = await start(root, 0, options);
  const port = first.server.address().port,
    headers = {
      Authorization: `Bearer ${"f".repeat(64)}`,
      Origin: first.origin,
      "Content-Type": "application/json",
    };
  const state = engine.snapshot();
  expect(
    (
      await wire(first, `/api/proposals/${proposal.id}/accept`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          revision: proposal.revision,
          stateId: state.stateId,
        }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await wire(first, "/api/comments", {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: "Keep this comment",
          target: {
            revision: proposal.revision,
            element: "intro",
            selector: { type: "element" },
          },
        }),
      })
    ).status,
  ).toBe(201);
  writeFileSync(
    join(candidate, "document.html"),
    '<!doctype html><html><head><title>Preview</title></head><body><p data-dstar-id="intro">Edited later</p></body></html>',
  );
  const pending = engine.propose({
    candidate,
    base: proposal.revision,
    request: "Next",
    author: "agent",
    key: "next",
  });
  const before = engine.snapshot();
  const preview = (
    await wire(first, `/api/preview/${proposal.id}`, { headers })
  ).json();
  await close(first.server);
  const second = await start(root, port, options);
  expect((await wire(second, "/api/state", { headers })).json().state).toEqual(
    before.state,
  );
  expect((await wire(second, preview.url)).status).toBe(404);
  expect(
    (await wire(second, `/api/preview/${pending.id}`, { headers })).status,
  ).toBe(200);
  expect(readFileSync(join(root, "document.html"), "utf8")).toContain(
    "Hello 🌍",
  );
  await close(second.server);
  writeFileSync(tokenFile, "g".repeat(64));
  const rotated = await start(root, port, options);
  expect((await wire(rotated, "/api/state", { headers })).status).toBe(401);
  expect(
    (
      await wire(rotated, "/api/state", {
        headers: { Authorization: `Bearer ${"g".repeat(64)}` },
      })
    ).json().stateId,
  ).toBe(before.stateId);
});

it("separates owner and reviewer authority, binds trusted identities and scopes reviewer handoffs", async () => {
  const { root, candidate, engine, proposal } = fixture(),
    ownerToken = "o".repeat(64),
    reviewerToken = "r".repeat(64),
    options = {
      ownerToken,
      reviewerToken,
      ownerDisplayName: "Olivia Owner",
      reviewerDisplayName: "Ravi Reviewer",
      workspaceManagementUrl: `https://manage.review.test/workspaces/${"a".repeat(32)}#${"m".repeat(64)}`,
    },
    viewer = await start(root, 0, options),
    owner = {
      Authorization: `Bearer ${ownerToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    },
    reviewer = {
      Authorization: `Bearer ${reviewerToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    };
  expect(viewer.url).toBe(viewer.ownerUrl);
  expect(new URL(viewer.ownerUrl).hash.slice(1)).toBe(ownerToken);
  expect(new URL(viewer.reviewerUrl).hash.slice(1)).toBe(reviewerToken);

  const ownerState = (
      await wire(viewer, "/api/state", { headers: owner })
    ).json(),
    reviewerState = (
      await wire(viewer, "/api/state", { headers: reviewer })
    ).json();
  expect(ownerState.session).toMatchObject({
    role: "owner",
    identity: { displayName: "Olivia Owner", role: "owner" },
  });
  expect(ownerState.workspaceManagementUrl).toBe(
    options.workspaceManagementUrl,
  );
  expect(ownerState.session.capabilities).toEqual(
    expect.arrayContaining(["decide", "resolve", "share", "handoff"]),
  );
  expect(reviewerState.session).toMatchObject({
    role: "reviewer",
    identity: { displayName: "Ravi Reviewer", role: "reviewer" },
  });
  expect(reviewerState.session.capabilities).toEqual(
    expect.arrayContaining(["read", "comment", "handoff", "reply"]),
  );
  expect(reviewerState.session.capabilities).not.toEqual(
    expect.arrayContaining(["propose", "decide", "resolve", "share"]),
  );
  expect(reviewerState).not.toHaveProperty("workspaceManagementUrl");
  expect(JSON.stringify(reviewerState)).not.toContain(ownerToken);
  expect(
    (
      await wire(viewer, "/api/state", {
        headers: { Authorization: `Bearer ${"x".repeat(64)}` },
      })
    ).status,
  ).toBe(401);

  expect(
    (
      await wire(viewer, `/api/proposals/${proposal.id}/accept`, {
        method: "POST",
        headers: reviewer,
        body: JSON.stringify({
          revision: proposal.revision,
          stateId: reviewerState.stateId,
        }),
      })
    ).status,
  ).toBe(403);
  expect(engine.snapshot().revision).toBeNull();
  expect(
    (
      await wire(viewer, `/api/proposals/${proposal.id}/accept`, {
        method: "POST",
        headers: owner,
        body: JSON.stringify({
          revision: proposal.revision,
          stateId: ownerState.stateId,
        }),
      })
    ).status,
  ).toBe(200);
  expect(engine.snapshot().state.proposals[0].decision.actor).toEqual({
    id: "owner",
    displayName: "Olivia Owner",
    role: "owner",
  });

  expect(
    (
      await wire(viewer, "/api/agent/proposals", {
        method: "POST",
        headers: reviewer,
        body: "{}",
      })
    ).status,
  ).toBe(403);

  const target = {
    revision: proposal.revision,
    element: "intro",
    selector: { type: "element" },
  };
  expect(
    (
      await wire(viewer, "/api/comments", {
        method: "POST",
        headers: reviewer,
        body: JSON.stringify({
          target,
          body: "Spoofed",
          author: { id: "owner", displayName: "Olivia Owner", role: "owner" },
        }),
      })
    ).status,
  ).toBe(409);
  const posted = (
    await wire(viewer, "/api/comments", {
      method: "POST",
      headers: reviewer,
      body: JSON.stringify({ target, body: "Reviewer comment" }),
    })
  ).json();
  expect(posted.author).toEqual({
    id: "reviewer",
    displayName: "Ravi Reviewer",
    role: "reviewer",
  });
  expect(
    (
      await wire(viewer, `/api/comments/${posted.id}/resolve`, {
        method: "POST",
        headers: reviewer,
        body: JSON.stringify({ stateId: engine.snapshot().stateId }),
      })
    ).status,
  ).toBe(403);
  const replied = (
    await wire(viewer, `/api/comments/${posted.id}/reply`, {
      method: "POST",
      headers: reviewer,
      body: JSON.stringify({
        body: "Reviewer reply",
        stateId: engine.snapshot().stateId,
      }),
    })
  ).json();
  expect(replied.replies[0].author).toEqual({
    id: "reviewer",
    displayName: "Ravi Reviewer",
    role: "reviewer",
  });

  writeFileSync(
    join(candidate, "document.html"),
    '<!doctype html><html><head><title>Preview</title></head><body><p data-dstar-id="intro">Next text</p></body></html>',
  );
  const pending = engine.propose({
      candidate,
      base: proposal.revision,
      request: "Next",
      author: "agent",
      key: "role-next",
    }),
    handoffId = "11111111-1111-4111-8111-111111111111",
    accessToken = "h".repeat(64),
    context = {
      review: {
        proposalId: pending.id,
        showingBase: false,
        revision: pending.revision,
        previewStatus: "ready",
      },
      selection: {
        revision: pending.revision,
        element: "intro",
        selector: { type: "element" },
      },
      action: {
        kind: "comment",
        target: {
          revision: pending.revision,
          element: "intro",
          selector: { type: "element" },
        },
        draft: "",
      },
      focusedCommentId: null,
    };
  const handoff = await wire(viewer, "/api/handoffs", {
    method: "POST",
    headers: reviewer,
    body: JSON.stringify({ id: handoffId, accessToken, context }),
  });
  expect(handoff.status).toBe(201);
  expect(handoff.text).not.toContain(accessToken);
  expect(handoff.json().session).toMatchObject({
    role: "reviewer",
    capabilities: ["read", "handoff"],
  });
  const scopedHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Origin: viewer.origin,
      "Content-Type": "application/json",
    },
    toolContext = await wire(viewer, "/api/agent/context", {
      method: "POST",
      headers: scopedHeaders,
      body: JSON.stringify(context),
    });
  expect(toolContext.status).toBe(200);
  expect(toolContext.json().session).toMatchObject({
    role: "reviewer",
    capabilities: ["read", "handoff"],
  });
  expect(
    (await wire(viewer, `/api/handoffs/${handoffId}`, { headers: owner }))
      .status,
  ).toBe(403);
  expect(
    (
      await wire(viewer, `/api/handoffs/${handoffId}/revoke`, {
        method: "POST",
        headers: owner,
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await wire(viewer, `/api/proposals/${pending.id}/reject`, {
        method: "POST",
        headers: scopedHeaders,
        body: JSON.stringify({
          revision: pending.revision,
          stateId: engine.snapshot().stateId,
        }),
      })
    ).status,
  ).toBe(403);

  const resolved = (
    await wire(viewer, `/api/comments/${posted.id}/resolve`, {
      method: "POST",
      headers: owner,
      body: JSON.stringify({ stateId: engine.snapshot().stateId }),
    })
  ).json();
  expect(resolved).toMatchObject({
    status: "resolved",
    resolvedBy: {
      id: "owner",
      displayName: "Olivia Owner",
      role: "owner",
    },
  });
  expect(resolved.resolvedAt).toMatch(/^\d{4}-/);

  await close(viewer.server);
  const reopened = await start(
      root,
      viewer.server.address()?.port ?? 0,
      options,
    ),
    persisted = (
      await wire(reopened, "/api/state", {
        headers: { Authorization: `Bearer ${reviewerToken}` },
      })
    ).json();
  expect(persisted.state.comments[0]).toMatchObject({
    author: { role: "reviewer", displayName: "Ravi Reviewer" },
    resolvedBy: { role: "owner", displayName: "Olivia Owner" },
  });
});

it("validates configuration before opening any document and fails closed on missing or corrupt packages", async () => {
  const { root, temp } = fixture();
  const missing = join(temp, "not-created");
  await expect(startViewer(missing, 0, { host: "0.0.0.0" })).rejects.toThrow(
    /externalOrigin/,
  );
  expect(existsSync(missing)).toBe(false);
  await expect(startViewer(missing)).rejects.toThrow();
  writeFileSync(join(root, ".dstar", "state.json"), "broken");
  await expect(startViewer(root)).rejects.toThrow();
});

it("runs the service entrypoint, suppresses secret/path logging, and reopens the same state after SIGTERM", async () => {
  const { root, temp, engine, proposal } = fixture();
  const tokenFile = join(temp, "private-token"),
    token = "h".repeat(64);
  writeFileSync(tokenFile, token);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("DSTAR_")),
  );
  Object.assign(env, {
    DSTAR_PACKAGE_ROOT: root,
    DSTAR_PORT: "0",
    DSTAR_VIEWER_TOKEN_FILE: tokenFile,
  });
  // Also exercise the same explicit parsing contract used by the process.
  expect(viewerConfigFromEnv(env).root).toBe(root);
  async function launch(overrides = {}) {
    const child = spawn(
      process.execPath,
      [new URL("./start.mjs", import.meta.url).pathname],
      { env: { ...env, ...overrides }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    });
    for (
      let attempt = 0;
      attempt < 200 &&
      child.exitCode === null &&
      !output.includes("listening at");
      attempt++
    )
      await delay(10);
    return { child, exited, output: () => output };
  }
  for (let run = 0; run < 2; run++) {
    const service = await launch();
    const origin = /listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(
      service.output(),
    )?.[1];
    expect(origin).toBeTruthy();
    expect(service.output()).not.toContain(token);
    expect(service.output()).not.toContain(root);
    expect(service.output()).not.toContain(tokenFile);
    const state = await (
      await fetch(`${origin}/api/state`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(state.stateId).toBe(engine.snapshot().stateId);
    if (run === 0) {
      const headers = {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        "Content-Type": "application/json",
      };
      expect(
        (
          await fetch(`${origin}/api/proposals/${proposal.id}/accept`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              revision: proposal.revision,
              stateId: state.stateId,
            }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${origin}/api/comments`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              body: "Persist across processes",
              target: {
                revision: proposal.revision,
                element: "intro",
                selector: { type: "element" },
              },
            }),
          })
        ).status,
      ).toBe(201);
    } else {
      expect(state.revision).toBe(proposal.revision);
      expect(state.state.comments[0].body).toBe("Persist across processes");
      expect(readFileSync(join(root, "document.html"), "utf8")).toContain(
        "Hello 🌍",
      );
    }
    service.child.kill("SIGTERM");
    expect(await service.exited).toEqual([0, null]);
  }
  const broken = await launch({ DSTAR_VIEWER_TOKEN_FILE: join(temp, token) });
  expect(await broken.exited).toEqual([1, null]);
  expect(broken.output()).toContain("startup failed");
  expect(broken.output()).not.toContain(token);
  expect(broken.output()).not.toContain(temp);
});

const html = (text = "Hello 🌍") =>
  `<!doctype html><html><head><title>Agent test</title></head><body><p data-dstar-id="intro">${text}</p></body></html>`;
const candidateFiles = (text) => [
  { path: "document.html", encoding: "utf8", content: html(text) },
  { path: "styles.css", encoding: "utf8", content: "body { color: #123; }" },
  {
    path: "assets/pixel.gif",
    encoding: "base64",
    content: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  },
];
async function agentFixture() {
  const temp = mkdtempSync(join(tmpdir(), "dstar-agent-test-"));
  cleanup.push(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "document"),
    engine = open(root);
  // An existing empty HTML-first package, before any genesis proposal.
  mkdirSync(join(root, ".dstar"), { recursive: true });
  writeFileSync(
    join(root, ".dstar/state.json"),
    JSON.stringify({
      format: "dstar-html-0.2-dev",
      id: "11111111-1111-4111-8111-111111111111",
      generation: 0,
      head: null,
      proposals: [],
      comments: [],
    }),
  );
  const viewer = await startViewer(root);
  cleanup.push(() => new Promise((resolve) => viewer.server.close(resolve)));
  const token = new URL(viewer.url).hash.slice(1);
  const request = (route, body, extraHeaders = {}) =>
    fetch(`${viewer.origin}/api/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: viewer.origin,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  const api = async (route, body) => {
    const response = await request(route, body),
      result = await response.json();
    if (route.startsWith("agent/")) expect(result).not.toHaveProperty("key");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(temp);
    return { ...result, status: response.status };
  };
  const propose = (key, base = null, text = "Hello 🌍") =>
    api("agent/proposals", {
      base,
      request: `Edit ${text}`,
      key,
      files: candidateFiles(text),
    });
  const decide = async (p, action = "accept") =>
    api(`proposals/${p.id}/${action}`, {
      revision: p.revision,
      stateId: engine.snapshot().stateId,
    });
  return { root, engine, viewer, request, api, propose, decide };
}

it("completes agent propose/read/selection/reply and explicit human decisions without leaking credentials", async () => {
  const { root, engine, api, propose, decide } = await agentFixture();
  const first = await propose("genesis");
  expect(first.status).toBe(200);
  const p = first.proposal;
  expect(p.status).toBe("pending");
  expect(p).not.toHaveProperty("command");
  expect(p).not.toHaveProperty("changes");
  expect(engine.snapshot().revision).toBeNull();
  const read = await api("agent/document", { revision: p.revision });
  expect(read.files).toEqual(
    candidateFiles().sort((a, b) => a.path.localeCompare(b.path)),
  );
  expect(revision(decodeCandidate(read.files))).toBe(p.revision);
  const target = {
    revision: p.revision,
    element: "intro",
    selector: {
      type: "text-range",
      start: 6,
      end: 7,
      unit: "unicode-code-point",
      exact: "🌍",
    },
  };
  const c = await api("comments", {
    target,
    body: "Please revise this greeting",
  });
  expect(c.status).toBe(201);
  const contextArgs = {
    review: {
      proposalId: p.id,
      showingBase: false,
      revision: p.revision,
      previewStatus: "ready",
    },
    selection: target,
    focusedCommentId: c.id,
  };
  const context = await api("agent/context", contextArgs);
  expect(context.head).toBeNull();
  expect(context.selection).toEqual(target);
  expect(context.focusedComment).toMatchObject({
    id: c.id,
    body: "Please revise this greeting",
    status: "open",
    viewedResolution: { status: "exact" },
  });
  expect(context.comments[0].viewedResolution.status).toBe("exact");
  expect(context.resolutionRevision).toBe(p.revision);
  expect(
    (
      await api("agent/context", {
        ...contextArgs,
        action: { kind: "suggest", target, draft: "Make it friendlier" },
      })
    ).code,
  ).toBe("invalid_input");
  expect(
    (
      await api("agent/context", {
        ...contextArgs,
        action: {
          kind: "comment",
          target: { ...target, element: "different" },
        },
      })
    ).code,
  ).toBe("invalid_input");
  expect(
    (
      await api("agent/context", {
        ...contextArgs,
        focusedCommentId: "22222222-2222-4222-8222-222222222222",
      })
    ).code,
  ).toBe("invalid_input");
  const replyArgs = {
    commentId: c.id,
    body: "I will propose a revision",
    key: "reply-one",
  };
  const reply = await api("agent/reply", replyArgs);
  expect(reply.comment.status).toBe("open");
  expect(reply.comment.replies).toHaveLength(1);
  expect(reply.comment.replies[0].author).toEqual({
    id: "agent",
    displayName: "Agent",
    role: "agent",
  });
  expect(reply.comment.replies[0]).not.toHaveProperty("key");
  const stateId = engine.snapshot().stateId;
  expect((await api("agent/reply", replyArgs)).comment.replies).toHaveLength(1);
  expect(open(root).snapshot().stateId).toBe(stateId);
  expect(
    (await api("agent/reply", { ...replyArgs, body: "Changed reply" })).code,
  ).toBe("idempotency_conflict");
  expect((await decide(p)).status).toBe(200);
  expect((await propose("genesis")).proposal.id).toBe(p.id);
  expect((await propose("genesis", null, "Different")).code).toBe(
    "idempotency_conflict",
  );
  const next = (await propose("second", p.revision, "Hello world")).proposal;
  expect(next.diff.elementChangeCount).toBe(1);
  expect(engine.snapshot().revision).toBe(p.revision);
  // Both the viewed base and its selection stay pinned to the original revision.
  const comparing = await api("agent/context", {
    ...contextArgs,
    review: { ...contextArgs.review, proposalId: next.id, showingBase: true },
  });
  expect(comparing.selection.revision).toBe(p.revision);
  expect((await decide(next, "reject")).status).toBe(200);
  const final = await api("agent/context", {});
  expect(final.proposals.map((p) => p.status)).toEqual([
    "accepted",
    "rejected",
  ]);
  expect(final.head.revision).toBe(p.revision);
  expect(final.comments[0].status).toBe("open");
});

it("rejects stale bases, mismatched selections and stale human review states; preserves competing proposals", async () => {
  const { engine, api, propose, decide } = await agentFixture();
  const genesis = (await propose("first")).proposal;
  await decide(genesis);
  const [a, b] = await Promise.all([
    propose("a", genesis.revision, "A"),
    propose("b", genesis.revision, "B"),
  ]);
  expect(a.proposal.base).toBe(b.proposal.base);
  const stateId = engine.snapshot().stateId;
  await api("comments", {
    target: {
      revision: a.proposal.revision,
      element: "intro",
      selector: { type: "element" },
    },
    body: "A comment changes review state",
  });
  expect(
    (
      await api(`proposals/${a.proposal.id}/accept`, {
        stateId,
        revision: a.proposal.revision,
      })
    ).status,
  ).toBe(409);
  await decide(a.proposal);
  expect((await decide(b.proposal)).status).toBe(409);
  expect((await propose("stale", genesis.revision, "C")).code).toBe(
    "stale_base",
  );
  expect((await propose("none-after-genesis")).code).toBe("stale_base");
  const review = {
    proposalId: b.proposal.id,
    revision: b.proposal.revision,
    showingBase: false,
    previewStatus: "ready",
  };
  expect((await api("agent/context", { review })).review.stale).toBe(true);
  for (const [r, target] of [
    [
      review,
      {
        revision: genesis.revision,
        element: "intro",
        selector: { type: "element" },
      },
    ],
    [
      review,
      {
        revision: review.revision,
        element: "intro",
        selector: {
          type: "text-range",
          start: 0,
          end: 1,
          unit: "unicode-code-point",
          exact: "X",
        },
      },
    ],
    [
      { ...review, previewStatus: "loading" },
      {
        revision: review.revision,
        element: "intro",
        selector: { type: "element" },
      },
    ],
  ])
    expect(
      (await api("agent/context", { review: r, selection: target })).status,
    ).toBeGreaterThanOrEqual(400);
  expect(
    (
      await api("agent/context", {
        review: { ...review, revision: genesis.revision },
      })
    ).status,
  ).toBe(400);
  expect((await api("agent/document", { revision: "head" })).status).toBe(400);
  expect(
    (await api("agent/document", { revision: `sha256:${"f".repeat(64)}` }))
      .code,
  ).toBe("not_found");
});

it("limits agent routes, authority, input shapes, byte sizes and capabilities", async () => {
  const { viewer, request, api, engine } = await agentFixture();
  const stateId = engine.snapshot().stateId;
  expect(
    (await request("agent/context", {}, { Authorization: "Bearer wrong" }))
      .status,
  ).toBe(401);
  expect(
    (await request("agent/context", {}, { Origin: "http://evil.invalid" }))
      .status,
  ).toBe(403);
  expect(
    (await request("agent/context", {}, { "Content-Type": "text/plain" }))
      .status,
  ).toBe(403);
  for (const route of [
    "accept",
    "reject",
    "resolve",
    "export",
    "shell",
    "fetch",
  ])
    expect((await api(`agent/${route}`, {})).status).toBe(404);
  for (const body of [
    null,
    [],
    { candidate: "/etc/passwd" },
    { url: "https://example.com" },
    { command: "ls" },
  ])
    expect((await api("agent/proposals", body)).status).toBe(400);
  const raw = await request("agent/context", { huge: "x".repeat(65536) });
  expect(raw.status).toBe(413);
  expect(
    (
      await request("agent/proposals", {
        huge: "x".repeat(AGENT_LIMITS.requestBytes),
      })
    ).status,
  ).toBe(413);
  expect(engine.snapshot().stateId).toBe(stateId);
  const page = await fetch(viewer.origin);
  expect(page.headers.get("origin-agent-cluster")).toBe("?1");
  expect(page.headers.get("permissions-policy")).toBe("tools=(self)");
  const pageHtml = await page.text();
  expect(pageHtml).toContain("tools 'none'");
  for (const label of [
    "Comments",
    "Versions",
    "View changes",
    "Back to document",
    "Newest first. Select a version to open it.",
    "Before",
    "After",
  ])
    expect(pageHtml).toContain(label);
  expect(pageHtml).not.toContain('id="view-preview"');
  expect(pageHtml).not.toContain('id="view-changes"');
  expect(pageHtml).not.toContain('id="toggle-review"');
  expect(pageHtml).not.toContain('id="review-changes-entry"');
  expect(pageHtml).not.toContain('class="version-list-group');
  expect(pageHtml).not.toContain('class="version-group');
  expect(pageHtml).not.toContain("Show base");
  for (const path of ["webmcp.js", "review-state.js", "viewer-model.js"])
    expect((await fetch(`${viewer.origin}/${path}`)).status).toBe(200);
});

it("validates complete candidate content without accepting paths, scripts, remote resources or malformed encodings", async () => {
  const { api, engine } = await agentFixture();
  const before = engine.snapshot().stateId;
  const invalid = [
    ...[
      "/tmp/file",
      "../document.html",
      "assets/../secret.png",
      "assets/%2e.png",
      "assets\\x.png",
      ".dstar/state.json",
      "assets/x.svg",
      "styles/x.js",
      `assets/${"x/".repeat(13)}a.png`,
      `assets/${"a".repeat(240)}.png`,
    ].map((path) => [{ path, encoding: "base64", content: "AA==" }]),
    [
      {
        path: "document.html",
        encoding: "utf8",
        content: html("<script>alert(1)</script>"),
      },
    ],
    [
      {
        path: "document.html",
        encoding: "utf8",
        content: html(
          '<img data-dstar-id="img" alt="x" src="https://evil.invalid/a.png">',
        ),
      },
    ],
    [
      { path: "document.html", encoding: "utf8", content: html() },
      {
        path: "styles.css",
        encoding: "utf8",
        content: '@import "https://evil.invalid/x.css";',
      },
    ],
    [...candidateFiles(), { ...candidateFiles()[1] }],
    [
      ...candidateFiles(),
      { path: "assets/PIXEL.gif", encoding: "base64", content: "AA==" },
    ],
    [
      ...candidateFiles(),
      { path: "assets/pixel.gif/x.gif", encoding: "base64", content: "AA==" },
    ],
    [
      ...candidateFiles(),
      { path: "styles/Theme/a.css", encoding: "utf8", content: "" },
      { path: "styles/theme/b.css", encoding: "utf8", content: "" },
    ],
    [{ path: "document.html", encoding: "utf8", content: "\ud800" }],
    [
      ...candidateFiles(),
      { path: "assets/a.png", encoding: "base64", content: "bad=!" },
    ],
    [{ path: "document.html", encoding: "base64", content: "AA==" }],
    [
      {
        path: "document.html",
        encoding: "utf8",
        content: "x".repeat(AGENT_LIMITS.fileBytes + 1),
      },
    ],
  ];
  for (const files of invalid) {
    const result = await api("agent/proposals", {
      base: null,
      request: "Invalid",
      key: "invalid",
      files,
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
  }
  expect(() =>
    decodeCandidate(Array.from({ length: 513 }, () => candidateFiles()[0])),
  ).toThrow("file count");
  const large = "a".repeat(7 * 1024 * 1024);
  expect(() =>
    decodeCandidate(
      Array.from({ length: 5 }, (_, i) => ({
        path: `styles/${i}.css`,
        encoding: "utf8",
        content: large,
      })),
    ),
  ).toThrow("Candidate too large");
  expect(engine.snapshot().stateId).toBe(before);
});

it("cleans private staging after an Engine failure and never returns host error details", async () => {
  let staging, response;
  const origin = "http://127.0.0.1:12345";
  const body = {
    base: null,
    request: "Test cleanup",
    key: "cleanup",
    files: candidateFiles(),
  };
  const req = {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  await agentRoute({
    req,
    origin,
    path: "/api/agent/proposals",
    json: (status, data) => {
      response = { status, data };
    },
    engine: {
      propose(args) {
        staging = args.candidate;
        expect(existsSync(join(staging, "document.html"))).toBe(true);
        throw new Error(
          "Cannot write /private/server/secret-location with credential SECRET",
        );
      },
    },
  });
  expect(response.status).toBe(422);
  expect(JSON.stringify(response)).not.toContain("secret-location");
  expect(JSON.stringify(response)).not.toContain("SECRET");
  expect(existsSync(staging)).toBe(false);
});

it("allows identical retries after a busy Engine without leaking the lock path", async () => {
  const { root, engine, propose } = await agentFixture();
  const before = engine.snapshot().stateId;
  const lock = join(root, ".dstar/write.lock");
  writeFileSync(lock, "test-only lock");
  try {
    expect((await propose("busy-retry")).code).toBe("busy");
  } finally {
    rmSync(lock);
  }
  expect(engine.snapshot().stateId).toBe(before);
  expect((await propose("busy-retry")).proposal.status).toBe("pending");
});

it("keeps all agent routes inside configured authority and persists retries across restart", async () => {
  const { root, temp, engine, proposal } = fixture();
  const token = "integration-test-credential-" + "x".repeat(48);
  const tokenFile = join(temp, "viewer-token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const options = {
    externalOrigin: "https://review.example.test:8443",
    tokenFile,
  };
  let viewer = await start(root, 0, options);
  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: options.externalOrigin,
    "Content-Type": "application/json",
  };
  const post = (path, body, extra = {}) =>
    wire(viewer, path, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  const api = async (path, body) => {
    const response = await post(path, body);
    expect(response.status).toBe(200);
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain(tokenFile);
    return response.json();
  };
  await api(`/api/proposals/${proposal.id}/accept`, {
    revision: proposal.revision,
    stateId: engine.snapshot().stateId,
  });
  const selection = {
    revision: proposal.revision,
    element: "intro",
    selector: {
      type: "text-range",
      start: 6,
      end: 7,
      unit: "unicode-code-point",
      exact: "🌍",
    },
  };
  const comment = (
    await post("/api/comments", { target: selection, body: "Keep the globe" })
  ).json();
  const review = {
    proposalId: proposal.id,
    revision: proposal.revision,
    showingBase: false,
    previewStatus: "ready",
  };
  const context = await api("/api/agent/context", { review, selection });
  expect(context.selection).toEqual(selection);
  expect(context.comments[0].target.revision).toBe(proposal.revision);
  expect(context.head.revision).toBe(proposal.revision);
  const document = await api("/api/agent/document", {
    revision: proposal.revision,
  });
  // Exceeds the ordinary 64 KiB POST cap, proving the agent body reader is used.
  const request = {
    base: proposal.revision,
    request: "Configured origin candidate",
    key: "configured-proposal",
    files: document.files.map((file) => ({
      ...file,
      content:
        file.content.replace("Hello 🌍", "Hello 🌍 updated") +
        " ".repeat(70000),
    })),
  };
  const pending = (await api("/api/agent/proposals", request)).proposal;
  expect(engine.snapshot().revision).toBe(proposal.revision);
  const reply = {
    commentId: comment.id,
    body: "Candidate is ready",
    key: "configured-reply",
  };
  await api("/api/agent/reply", reply);
  const before = engine.snapshot().stateId;
  for (const route of ["context", "document", "proposals", "reply"])
    for (const denied of [
      { Authorization: "Bearer wrong" },
      { Host: "evil.example.test" },
      { Origin: "https://evil.example.test" },
      { "X-Forwarded-Host": "review.example.test:8443" },
    ]) {
      const result = await post(`/api/agent/${route}`, {}, denied);
      expect(result.status).toBe(denied.Authorization ? 401 : 403);
    }
  expect(engine.snapshot().stateId).toBe(before);
  const preview = (
    await wire(viewer, `/api/preview/${pending.id}`, { headers })
  ).json();
  await close(viewer.server);
  viewer = await start(root, 0, options);
  expect((await wire(viewer, preview.url)).status).toBe(404);
  expect((await api("/api/agent/proposals", request)).proposal.id).toBe(
    pending.id,
  );
  expect((await api("/api/agent/reply", reply)).comment.replies).toHaveLength(
    1,
  );
  const reopened = await api("/api/agent/context", { review, selection });
  expect(reopened.stateId).toBe(before);
  expect(reopened.head.revision).toBe(proposal.revision);
  expect(reopened.comments[0].status).toBe("open");
  expect(
    (await api("/api/agent/document", { revision: pending.revision })).files,
  ).toEqual(request.files);
});
