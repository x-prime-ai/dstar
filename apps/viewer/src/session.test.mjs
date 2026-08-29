import { expect, it, vi } from "vitest";
import { accessToken, AUTH_MESSAGE, ViewerSession } from "../public/session.js";
import { createTools } from "../public/webmcp.js";

const origin = "http://127.0.0.1:4321";
const token = "a".repeat(48);
const newer = "b".repeat(48);
const response = (status, data = { state: { generation: 1 } }) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
function setup(saved) {
  const values = new Map(saved ? [["dstar-token", saved]] : []);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const fetch = vi.fn().mockResolvedValue(response(200));
  const onAuthorization = vi.fn();
  const session = new ViewerSession({
    fetch,
    storage: () => storage,
    onAuthorization,
  });
  const history = { replaceState: vi.fn() };
  const restore = (hash = "") =>
    session.restore({ origin, pathname: "/", search: "", hash }, history);
  return { session, fetch, onAuthorization, values, history, restore };
}

it("requires a credential in each browser and never sends a null Bearer token", async () => {
  const f = setup();
  f.restore();
  await expect(f.session.request("state")).rejects.toMatchObject({
    code: "authorization_required",
    message: AUTH_MESSAGE,
  });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.session.authorized).toBe(false);
  expect(() => f.session.accessLink(origin)).toThrow(AUTH_MESSAGE);
});

it("consumes a private link but marks authorization only after a successful state read", async () => {
  const f = setup();
  f.restore(`#${token}`);
  expect(f.history.replaceState).toHaveBeenCalledWith(null, "", "/");
  expect(f.session.authorized).toBe(false);
  expect(f.onAuthorization).not.toHaveBeenCalled();
  expect(f.values.size).toBe(0);
  await f.session.request("state");
  expect(f.fetch).toHaveBeenCalledWith("/api/state", {
    signal: undefined,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(f.fetch.mock.contexts[0]).toBeUndefined();
  expect(f.onAuthorization).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.values.get("dstar-token")).toBe(token);
  expect(f.session.accessLink(origin)).toBe(`${origin}/#${token}`);
  await f.session.request("state");
  expect(f.onAuthorization).toHaveBeenCalledTimes(1);
  const anotherBrowser = setup();
  anotherBrowser.restore();
  expect(anotherBrowser.session.authorized).toBe(false);
});

it("supports a stored credential and recovers from expiry without leaking it to tools", async () => {
  const f = setup(token);
  f.restore();
  await f.session.request("state");
  f.fetch.mockResolvedValueOnce(
    response(401, { error: `untrusted text ${token}` }),
  );
  const tools = createTools({
    api: (...args) => f.session.request(...args),
    getReviewContext: () => ({}),
    onMutation: vi.fn(),
  });
  const result = await tools[0].execute({});
  expect(JSON.parse(result)).toEqual({
    ok: false,
    code: "authorization_required",
    error: AUTH_MESSAGE,
  });
  expect(result).not.toContain(token);
  expect(f.onAuthorization).toHaveBeenLastCalledWith(false);
  expect(f.session.authorized).toBe(false);
  expect(f.values.size).toBe(0);
  await expect(f.session.request("state")).rejects.toMatchObject({
    code: "authorization_required",
  });
  expect(f.fetch).toHaveBeenCalledTimes(2);
  f.session.replace(`${origin}/#${newer}`, origin);
  await f.session.request("state");
  expect(f.session.authorized).toBe(true);
  expect(f.values.get("dstar-token")).toBe(newer);
});

it("rejects wrong-origin links and malformed tokens without changing a working session", async () => {
  const f = setup(token);
  f.restore();
  await f.session.request("state");
  for (const invalid of [
    `${origin}/`,
    `http://localhost:4321/#${token}`,
    `http://127.0.0.1:4322/#${token}`,
    `${origin}/other#${token}`,
    `${origin}/?token=${token}#${token}`,
    `http://name:password@127.0.0.1:4321/#${token}`,
    "short-token",
    "<script>bad</script>",
  ]) {
    expect(() => f.session.replace(invalid, origin)).toThrow();
    expect(f.session.accessLink(origin)).toBe(`${origin}/#${token}`);
  }
  expect(accessToken(` ${newer}\n`, origin)).toBe(newer);
  const corrupt = setup("invalid");
  corrupt.restore();
  expect(corrupt.values.size).toBe(0);
});

it("keeps login usable when session storage is unavailable", async () => {
  const session = new ViewerSession({
    fetch: async () => response(200),
    storage: () => {
      throw new Error("storage blocked");
    },
    onAuthorization: vi.fn(),
  });
  session.restore(
    { origin, pathname: "/", search: "", hash: `#${token}` },
    { replaceState: vi.fn() },
  );
  await session.request("state");
  expect(session.authorized).toBe(true);
});

it("caches public role capabilities and never lets a reviewer copy a share link", async () => {
  const f = setup();
  f.restore(`#${token}`);
  f.fetch.mockResolvedValueOnce(
    response(200, {
      state: { generation: 1 },
      session: {
        role: "reviewer",
        identity: {
          id: "reviewer",
          displayName: "Ravi Reviewer",
          role: "reviewer",
        },
        capabilities: [
          "read",
          "comment",
          "suggest",
          "propose",
          "handoff",
          "reply",
        ],
      },
    }),
  );
  await f.session.request("state");
  expect(f.session.can("comment")).toBe(true);
  expect(f.session.can("decide")).toBe(false);
  expect(f.session.session.identity.displayName).toBe("Ravi Reviewer");
  expect(() => f.session.accessLink(origin)).toThrow(/Only the Owner/);
});

it.each([200, 401])(
  "ignores a late %s from a replaced credential",
  async (status) => {
    const f = setup(token);
    f.restore();
    let finish;
    f.fetch.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const old = f.session.request("state");
    f.session.replace(newer, origin);
    await f.session.request("state");
    finish(response(status));
    await expect(old).rejects.toMatchObject({ code: "session_changed" });
    expect(f.session.authorized).toBe(true);
    expect(f.session.accessLink(origin)).toBe(`${origin}/#${newer}`);
  },
);

it("does not authenticate network errors or forbidden origins, and propagates abort signals", async () => {
  const f = setup(token);
  f.restore();
  f.fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(f.session.request("state")).rejects.toThrow("offline");
  f.fetch.mockResolvedValueOnce(response(403, { error: "Invalid origin" }));
  await expect(f.session.request("state")).rejects.toThrow("Invalid origin");
  expect(f.session.authorized).toBe(false);
  expect(f.onAuthorization).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  await f.session.request("agent/context", {}, signal);
  expect(f.fetch).toHaveBeenLastCalledWith("/api/agent/context", {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    body: "{}",
  });
  expect(f.session.authorized).toBe(false);
});
