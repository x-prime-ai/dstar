import { expect, it } from "vitest";
import { PreviewState } from "../public/preview-state.js";
import {
  RefreshGate,
  agentHandoffPrompt,
  addressCommentContext,
  reviewContext,
  selectionFromEvent,
  selectionMessageFromEvent,
  selectionButtonPosition,
  commentThreads,
  commentAppliesToVersion,
  annotationEventFromFrame,
} from "../public/review-state.js";

it("creates private handoff prompts that another browser task can open", () => {
  const id = "11111111-1111-4111-8111-111111111111",
    token = "a".repeat(64);
  const comment = agentHandoffPrompt(
      "comment",
      `http://127.0.0.1:4321/?handoff=${id}#${token}`,
    ),
    suggest = agentHandoffPrompt(
      "suggest",
      `https://viewer.example/?handoff=${id}#${token}`,
    ),
    address = agentHandoffPrompt(
      "address-comment",
      `https://viewer.example/?handoff=${id}#${token}`,
    );
  expect(comment).toContain("Open this private, short-lived DSTAR handoff");
  expect(comment).toContain("http://127.0.0.1:4321");
  expect(comment).toContain("draft_selection_comment");
  expect(suggest).toContain("https://viewer.example");
  expect(suggest).toContain("draft_selection_suggestion");
  expect(suggest).not.toContain("propose_revision");
  expect(address).toContain("draft_comment_reply");
  expect(address).toContain("commentIds");
  expect(address).toContain("focusedComment.id");
  expect(
    agentHandoffPrompt(
      "suggest",
      `https://viewer.example/?handoff=${id}#${token}`,
      "element",
    ),
  ).toContain("propose_revision");
  expect(() => agentHandoffPrompt("resolve", "https://viewer.example")).toThrow(
    "Unsupported agent handoff action",
  );
  expect(() =>
    agentHandoffPrompt("comment", "https://viewer.example/#token"),
  ).toThrow("incomplete");
});

it("builds an exact existing-comment action without borrowing a page selection", () => {
  const selected = {
      id: "proposal",
      base: "base-rev",
      revision: "candidate-rev",
    },
    comment = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "open",
      target: {
        revision: "older-rev",
        element: "intro",
        selector: { type: "element" },
      },
    },
    context = addressCommentContext(
      selected,
      false,
      { revision: "candidate-rev" },
      { status: "ready" },
      comment,
    );
  expect(context).toMatchObject({
    review: {
      proposalId: "proposal",
      revision: "candidate-rev",
      previewStatus: "ready",
    },
    selection: null,
    focusedCommentId: comment.id,
    action: {
      kind: "address-comment",
      commentId: comment.id,
      target: comment.target,
      draft: "",
    },
  });
  expect(
    addressCommentContext(
      selected,
      false,
      { revision: "old" },
      { status: "failed" },
      comment,
    ).review,
  ).toBeNull();
  expect(() =>
    addressCommentContext(
      selected,
      false,
      null,
      { status: "loading" },
      { ...comment, status: "resolved" },
    ),
  ).toThrow("open comment");
});

const frame = { capability: "cap-a", revision: "rev-a" };
const proposal = { status: "pending", parent: "base", revision: "rev-a" };
function setup() {
  const gate = new PreviewState(),
    source = {};
  gate.reset(frame);
  const event = {
    source,
    origin: "null",
    data: { kind: "dstar-preview", ...frame, status: "ready" },
  };
  return {
    gate,
    source,
    event,
    accepts: () => gate.canAccept(proposal, "base", false),
  };
}
it("does not accept iframe load events or untrusted/mismatched acknowledgements", () => {
  const { gate, source, event, accepts } = setup();
  for (const invalid of [
    { source, type: "load" },
    { ...event, source: {} },
    { ...event, origin: "http://localhost" },
    { ...event, data: { ...event.data, capability: "old-cap" } },
    { ...event, data: { ...event.data, revision: "old-revision" } },
    { ...event, data: { ...event.data, status: "unknown" } },
  ]) {
    expect(gate.receive(invalid, source)).toBe(false);
    expect(accepts()).toBe(false);
  }
  expect(gate.receive(event, source)).toBe(true);
  expect(accepts()).toBe(true);
  expect(gate.canAccept(proposal, "different-head", false)).toBe(false);
  expect(gate.canAccept(proposal, "base", true)).toBe(false);
  expect(
    gate.canAccept({ ...proposal, status: "accepted" }, "base", false),
  ).toBe(false);
});

it("keeps each root comment as an independent thread", () => {
  const a = {
    id: "a",
    status: "open",
    target: { element: "intro", revision: "old" },
  };
  const b = {
    id: "b",
    status: "resolved",
    target: { element: "heading", revision: "old" },
  };
  const c = {
    id: "c",
    status: "open",
    target: { element: "intro", revision: "new" },
  };
  const initial = commentThreads([a, b, c]);
  expect(initial).toEqual([
    { id: "a", element: "intro", comment: a },
    { id: "b", element: "heading", comment: b },
    { id: "c", element: "intro", comment: c },
  ]);
  const next = commentThreads([
    { ...a, status: "resolved" },
    b,
    c,
    { ...a, id: "d", target: { element: "footer" } },
  ]);
  expect(next.map((thread) => [thread.id, thread.element])).toEqual([
    ["a", "intro"],
    ["b", "heading"],
    ["c", "intro"],
    ["d", "footer"],
  ]);
});

it("shows comments only on their version or a located descendant", () => {
  const proposals = [
      { id: "v1", parent: null, revision: "rev-1" },
      { id: "v2", parent: "v1", revision: "rev-2" },
      { id: "declined", parent: "v1", revision: "rev-declined" },
    ],
    old = { id: "old", target: { revision: "rev-1" } },
    declined = { id: "declined-comment", target: { revision: "rev-declined" } },
    anchors = {
      old: { status: "recovered" },
      "declined-comment": { status: "exact" },
    };
  expect(commentAppliesToVersion(old, proposals, "v1", anchors)).toBe(true);
  expect(commentAppliesToVersion(old, proposals, "v2", anchors)).toBe(true);
  expect(commentAppliesToVersion(old, proposals, "declined", anchors)).toBe(
    true,
  );
  expect(
    commentAppliesToVersion(declined, proposals, "declined", anchors),
  ).toBe(true);
  expect(commentAppliesToVersion(declined, proposals, "v2", anchors)).toBe(
    false,
  );
  expect(
    commentAppliesToVersion(old, proposals, "v2", {
      old: { status: "orphaned" },
    }),
  ).toBe(false);
});

it("accepts annotation navigation only from the ready exact preview", () => {
  const source = {},
    ready = { status: "ready" };
  const event = {
    source,
    origin: "null",
    data: { kind: "dstar-annotation-focus", ...frame, group: "intro" },
  };
  expect(annotationEventFromFrame(event, source, frame, ready)).toBe(
    event.data,
  );
  for (const invalid of [
    { ...event, source: {} },
    { ...event, origin: "https://evil.invalid" },
    { ...event, data: { ...event.data, revision: "old" } },
    { ...event, data: { ...event.data, capability: "old" } },
    { ...event, data: { ...event.data, group: 1 } },
  ])
    expect(annotationEventFromFrame(invalid, source, frame, ready)).toBeNull();
  expect(
    annotationEventFromFrame(event, source, frame, { status: "loading" }),
  ).toBeNull();
});
it("fails closed after resource failure or timeout until a new preview begins", () => {
  for (const timeout of [false, true]) {
    const { gate, source, event, accepts } = setup();
    if (timeout) gate.fail();
    else
      expect(
        gate.receive(
          { ...event, data: { ...event.data, status: "failed" } },
          source,
        ),
      ).toBe(true);
    expect(gate.receive(event, source)).toBe(false);
    expect(accepts()).toBe(false);
    gate.reset({ ...frame, capability: "new-cap" });
    expect(gate.receive(event, source)).toBe(false);
    expect(accepts()).toBe(false);
    expect(
      gate.receive(
        { ...event, data: { ...event.data, capability: "new-cap" } },
        source,
      ),
    ).toBe(true);
    expect(accepts()).toBe(true);
  }
});
it("clears readiness immediately when switching or clearing previews", () => {
  const { gate, source, event, accepts } = setup();
  gate.receive(event, source);
  gate.reset();
  expect(accepts()).toBe(false);
  expect(gate.receive(event, source)).toBe(false);
});

it("discards out-of-order refreshes and older document generations", () => {
  const gate = new RefreshGate();
  const a = gate.begin(),
    b = gate.begin();
  expect(gate.accept(b, 4)).toBe(true);
  expect(gate.accept(a, 3)).toBe(false);
  expect(gate.accept(gate.begin(), 2)).toBe(false);
  expect(gate.accept(gate.begin(), 5)).toBe(true);
});
it("preserves exact selection revision for candidate/base and never rebinds it to a new head", () => {
  const selected = {
    id: "proposal",
    base: "base-rev",
    revision: "candidate-rev",
  };
  const target = {
    revision: "base-rev",
    element: "intro",
    selector: { type: "element" },
  };
  const ready = { status: "ready" };
  expect(
    reviewContext(selected, true, { revision: "base-rev" }, ready, target),
  ).toEqual({
    review: {
      proposalId: "proposal",
      showingBase: true,
      revision: "base-rev",
      previewStatus: "ready",
    },
    selection: target,
    action: null,
  });
  expect(
    reviewContext(selected, false, { revision: "candidate-rev" }, ready, target)
      .selection,
  ).toBeNull();
  expect(
    reviewContext(selected, true, { revision: "base-rev" }, ready, target, {
      kind: "suggest",
      target,
      draft: "Make this shorter",
    }).action,
  ).toEqual({ kind: "suggest", target, draft: "Make this shorter" });
  expect(
    reviewContext(
      selected,
      true,
      { revision: "base-rev" },
      ready,
      target,
      null,
      "11111111-1111-4111-8111-111111111111",
    ).focusedCommentId,
  ).toBe("11111111-1111-4111-8111-111111111111");
  expect(
    reviewContext(selected, true, { revision: "candidate-rev" }, ready, target)
      .review.previewStatus,
  ).toBe("loading");
  expect(
    reviewContext(
      selected,
      true,
      { revision: "base-rev" },
      { status: "failed" },
      target,
    ).selection,
  ).toBeNull();
});
it("accepts selections only from the ready exact frame, ignoring delayed old-frame messages", () => {
  const source = {},
    frame = { capability: "capability", revision: "rev" },
    ready = { status: "ready" };
  const target = {
    revision: "rev",
    element: "intro",
    selector: { type: "text-range", exact: "hello" },
  };
  const event = {
    source,
    origin: "null",
    data: { kind: "dstar-selection", capability: frame.capability, target },
  };
  expect(selectionFromEvent(event, source, frame, ready)).toBe(target);
  for (const [e, f, status] of [
    [event, frame, { status: "loading" }],
    [event, { ...frame, capability: "new-capability" }, ready],
    [{ ...event, source: {} }, frame, ready],
    [{ ...event, origin: "https://evil.invalid" }, frame, ready],
    [event, { ...frame, revision: "other" }, ready],
  ])
    expect(selectionFromEvent(e, source, f, status)).toBeNull();
});

it("only dismisses selections on authenticated messages from the current frame", () => {
  const source = {},
    ready = { status: "ready" };
  const event = {
    source,
    origin: "null",
    data: { kind: "dstar-selection", ...frame, target: null },
  };
  expect(selectionMessageFromEvent(event, source, frame, ready)).toEqual({
    target: null,
  });
  for (const invalid of [
    { ...event, source: {} },
    { ...event, data: { ...event.data, revision: "old-rev" } },
    { ...event, data: { ...event.data, capability: "old-cap" } },
  ])
    expect(selectionMessageFromEvent(invalid, source, frame, ready)).toBeNull();
});

it("positions the comment icon above a selection, or below at the top edge", () => {
  const frame = { left: 100, top: 80, right: 800, bottom: 600 };
  const viewport = { width: 1000, height: 700 };
  expect(
    selectionButtonPosition(
      { left: 20, top: 100, right: 120, bottom: 120 },
      frame,
      viewport,
    ),
  ).toEqual({ left: 151, top: 134 });
  expect(
    selectionButtonPosition(
      { left: 20, top: 2, right: 120, bottom: 22 },
      frame,
      viewport,
    ),
  ).toEqual({ left: 151, top: 110 });
});

it("clamps icons to the visible iframe on narrow screens and rejects invisible or malformed rectangles", () => {
  const frame = { left: -100, top: 80, right: 668, bottom: 600 };
  const viewport = { width: 390, height: 500 };
  expect(
    selectionButtonPosition(
      { left: 470, top: 380, right: 600, bottom: 430 },
      frame,
      viewport,
    ),
  ).toEqual({ left: 344, top: 414 });
  for (const rect of [
    null,
    {},
    { left: 0, top: 0, right: Infinity, bottom: 1 },
    { left: 1, top: 1, right: 1, bottom: 2 },
    { left: 800, top: 1, right: 900, bottom: 20 },
    { left: 120, top: -100, right: 220, bottom: -10 },
  ])
    expect(selectionButtonPosition(rect, frame, viewport)).toBeNull();
});
