import { expect, it } from "vitest";
import { PreviewState } from "../public/preview-state.js";

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
