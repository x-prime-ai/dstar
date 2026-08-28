import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, revision } from "@dstar/engine";
import { AGENT_LIMITS, decodeCandidate, agentRoute } from "./agent-api.mjs";
import { startViewer } from "./server.mjs";

const cleanup = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it("serves immutable isolated previews and requires session credentials for decisions", async () => {
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
  expect(frame.headers.get("permissions-policy")).toBe("tools=()");
  expect(
    (
      await fetch(viewer.origin + "/api/agent/context", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${preview.capability}`,
          Origin: viewer.origin,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(401);
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
  };
  const context = await api("agent/context", contextArgs);
  expect(context.head).toBeNull();
  expect(context.selection).toEqual(target);
  expect(context.comments[0].viewedResolution.status).toBe("exact");
  expect(context.resolutionRevision).toBe(p.revision);
  const replyArgs = {
    commentId: c.id,
    body: "I will propose a revision",
    key: "reply-one",
  };
  const reply = await api("agent/reply", replyArgs);
  expect(reply.comment.status).toBe("open");
  expect(reply.comment.replies).toHaveLength(1);
  expect(reply.comment.replies[0].author).toBe("agent");
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
  expect(await page.text()).toContain("tools 'none'");
  for (const path of ["webmcp.js", "review-state.js"])
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
