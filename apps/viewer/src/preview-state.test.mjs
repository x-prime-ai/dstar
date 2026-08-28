import { expect, it } from "vitest";
import { PreviewState } from "../public/preview-state.js";
import {
  RefreshGate,
  reviewContext,
  selectionFromEvent,
} from "../public/review-state.js";

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
  });
  expect(
    reviewContext(selected, false, { revision: "candidate-rev" }, ready, target)
      .selection,
  ).toBeNull();
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
