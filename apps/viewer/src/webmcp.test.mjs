import { expect, it, vi } from "vitest";
import { createTools, registerWebMCP } from "../public/webmcp.js";

const callbacks = () => ({
  api: vi.fn().mockResolvedValue({ revision: "exact" }),
  getReviewContext: vi.fn().mockReturnValue({ review: null, selection: null }),
  onMutation: vi.fn(),
  onDraftComment: vi.fn().mockReturnValue(true),
});
it("defines page-context, comment-draft and proposal tools with the current WebMCP signature", async () => {
  const cb = callbacks(),
    tools = createTools(cb);
  expect(tools.map((t) => t.name)).toEqual([
    "get_review_context",
    "read_document",
    "draft_selection_comment",
    "propose_revision",
    "reply_comment",
  ]);
  const signal = new AbortController().signal;
  for (const tool of tools) {
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.annotations.untrustedContentHint).toBe(true);
  }
  expect(tools.map((t) => t.annotations.readOnlyHint)).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
  for (const tool of tools.filter((t) => t.name !== "draft_selection_comment"))
    expect(JSON.parse(await tool.execute({}, { signal })).ok).toBe(true);
  expect(cb.api.mock.calls.every((call) => call[2] === signal)).toBe(true);
  expect(cb.api.mock.calls[0]).toEqual([
    "agent/context",
    { review: null, selection: null },
    signal,
  ]);
  expect(cb.onMutation).toHaveBeenCalledTimes(2);
});
it("fills an editable comment draft only for an exact Viewer comment action", async () => {
  const cb = callbacks(),
    tool = createTools(cb).find(
      (entry) => entry.name === "draft_selection_comment",
    ),
    target = {
      revision: "rev",
      element: "intro",
      selector: { type: "element" },
    };
  expect(JSON.parse(await tool.execute({ body: "Draft this" }))).toMatchObject({
    ok: false,
    code: "invalid_input",
  });
  cb.getReviewContext.mockReturnValue({
    review: { revision: "rev" },
    selection: target,
    action: { kind: "comment", target },
  });
  expect(JSON.parse(await tool.execute({ body: "Draft this" }))).toEqual({
    ok: true,
    drafted: true,
    viewerUpdated: true,
  });
  expect(cb.onDraftComment).toHaveBeenCalledWith({
    target,
    body: "Draft this",
  });
  cb.onDraftComment.mockReturnValue(false);
  expect(
    JSON.parse(await tool.execute({ body: "Replace this" })),
  ).toMatchObject({ ok: false, code: "draft_conflict" });
  expect(cb.api).not.toHaveBeenCalled();
});
it("captures current context when called, not when registered, and preserves successful writes after refresh failure", async () => {
  const cb = callbacks(),
    tools = createTools(cb),
    contextTool = tools.find((tool) => tool.name === "get_review_context"),
    proposalTool = tools.find((tool) => tool.name === "propose_revision");
  cb.getReviewContext.mockReturnValue({
    review: { revision: "new-view" },
    selection: { revision: "new-view" },
  });
  await contextTool.execute({});
  expect(cb.api).toHaveBeenLastCalledWith(
    "agent/context",
    cb.getReviewContext(),
    undefined,
  );
  cb.onMutation.mockRejectedValue(new Error("UI refresh disconnected"));
  const result = JSON.parse(await proposalTool.execute({ key: "same-key" }));
  expect(result).toMatchObject({ ok: true, viewerUpdated: false });
  cb.onMutation.mockResolvedValue(false);
  expect(
    JSON.parse(await proposalTool.execute({ key: "same-key" })).viewerUpdated,
  ).toBe(false);
});
it("returns safe actionable errors without serializing request credentials or host failures", async () => {
  const cb = callbacks(),
    proposalTool = createTools(cb).find(
      (tool) => tool.name === "propose_revision",
    );
  cb.api.mockRejectedValue(
    new Error("Bearer secret-token at /private/server/path"),
  );
  const unknown = await proposalTool.execute({});
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
  expect(JSON.parse(await proposalTool.execute({}))).toEqual({
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
  expect(entries).toHaveLength(5);
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
