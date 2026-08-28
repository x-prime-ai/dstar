import { expect, it, vi } from "vitest";
import { createTools, registerWebMCP } from "../public/webmcp.js";

const callbacks = () => ({
  api: vi.fn().mockResolvedValue({ revision: "exact" }),
  getReviewContext: vi.fn().mockReturnValue({ review: null, selection: null }),
  onMutation: vi.fn(),
});
it("defines only four proposal/read/reply tools with the current WebMCP signature and JSON-string output", async () => {
  const cb = callbacks(),
    tools = createTools(cb);
  expect(tools.map((t) => t.name)).toEqual([
    "get_review_context",
    "read_document",
    "propose_revision",
    "reply_comment",
  ]);
  const signal = new AbortController().signal;
  for (const [i, tool] of tools.entries()) {
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.annotations).toEqual({
      readOnlyHint: i < 2,
      untrustedContentHint: true,
    });
    const args = { example: i };
    const output = await tool.execute(args, { signal });
    expect(JSON.parse(output).ok).toBe(true);
    expect(cb.api.mock.calls[i][2]).toBe(signal);
  }
  expect(cb.api.mock.calls[0]).toEqual([
    "agent/context",
    { review: null, selection: null },
    signal,
  ]);
  expect(cb.onMutation).toHaveBeenCalledTimes(2);
});
it("captures current context when called, not when registered, and preserves successful writes after refresh failure", async () => {
  const cb = callbacks(),
    tools = createTools(cb);
  cb.getReviewContext.mockReturnValue({
    review: { revision: "new-view" },
    selection: { revision: "new-view" },
  });
  await tools[0].execute({});
  expect(cb.api).toHaveBeenLastCalledWith(
    "agent/context",
    cb.getReviewContext(),
    undefined,
  );
  cb.onMutation.mockRejectedValue(new Error("UI refresh disconnected"));
  const result = JSON.parse(await tools[2].execute({ key: "same-key" }));
  expect(result).toMatchObject({ ok: true, viewerUpdated: false });
  cb.onMutation.mockResolvedValue(false);
  expect(
    JSON.parse(await tools[2].execute({ key: "same-key" })).viewerUpdated,
  ).toBe(false);
});
it("returns safe actionable errors without serializing request credentials or host failures", async () => {
  const cb = callbacks(),
    tools = createTools(cb);
  cb.api.mockRejectedValue(
    new Error("Bearer secret-token at /private/server/path"),
  );
  const unknown = await tools[2].execute({});
  expect(unknown).not.toContain("secret-token");
  expect(unknown).not.toContain("/private");
  expect(JSON.parse(unknown)).toMatchObject({
    ok: false,
    code: "connection_error",
  });
  expect(unknown).toContain("same key");
  cb.api.mockRejectedValue(
    Object.assign(new Error("Accepted head changed"), { code: "stale_base" }),
  );
  expect(JSON.parse(await tools[2].execute({}))).toEqual({
    ok: false,
    code: "stale_base",
    error: "Accepted head changed",
  });
});
// Registration doubles below test the adapter contract only, NOT native browser support.
it("progressively enhances document.modelContext and unregisters with AbortSignal", async () => {
  const cb = callbacks(),
    entries = [];
  const document = {
    modelContext: {
      registerTool: vi.fn(async (tool, options) => {
        entries.push([tool, options]);
      }),
    },
  };
  const result = await registerWebMCP({ document, ...cb });
  expect(result.status).toBe("registered");
  expect(entries).toHaveLength(4);
  expect(entries.every(([, options]) => !options.signal.aborted)).toBe(true);
  result.dispose();
  expect(entries.every(([, options]) => options.signal.aborted)).toBe(true);
  expect(Object.keys(document)).toEqual(["modelContext"]);
});
it("rolls back partial registration and leaves unsupported browsers alone", async () => {
  const cb = callbacks(),
    signals = [];
  const document = {
    modelContext: {
      registerTool: vi.fn(async (_, { signal }) => {
        signals.push(signal);
        if (signals.length === 2) throw new Error("native registration failed");
      }),
    },
  };
  expect((await registerWebMCP({ document, ...cb })).status).toBe("failed");
  expect(signals.every((s) => s.aborted)).toBe(true);
  const unsupported = {};
  expect((await registerWebMCP({ document: unsupported, ...cb })).status).toBe(
    "unsupported",
  );
  expect(unsupported).toEqual({});
  expect(cb.api).not.toHaveBeenCalled();
  const denied = Object.defineProperty({}, "modelContext", {
    get() {
      throw new Error("Permission denied");
    },
  });
  expect((await registerWebMCP({ document: denied, ...cb })).status).toBe(
    "failed",
  );
});
