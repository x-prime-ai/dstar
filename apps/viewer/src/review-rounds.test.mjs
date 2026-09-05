import { describe, expect, it } from "vitest";
import {
  feedbackDrift,
  proposalChangeDestination,
  revisionComposerState,
  revisionRequestStatus,
  revisionSelection,
} from "../public/review-rounds.js";
import { agentHandoffPrompt } from "../public/review-state.js";

const comments = [
  { id: "open-b", status: "open" },
  { id: "resolved", status: "resolved" },
  { id: "open-a", status: "open" },
];

describe("revision request selection", () => {
  it("keeps unique current open comments in stable order", () => {
    expect(
      revisionSelection(comments, ["open-b", "resolved", "open-a", "open-b"]),
    ).toEqual(["open-a", "open-b"]);
  });

  it("allows comments-only and instruction-only requests but rejects empty ones", () => {
    expect(
      revisionComposerState({
        comments,
        selectedIds: ["open-a"],
        instruction: "",
        canCompose: true,
      }).canSubmit,
    ).toBe(true);
    expect(
      revisionComposerState({
        comments,
        selectedIds: [],
        instruction: "  Tighten the conclusion.  ",
        canCompose: true,
      }),
    ).toMatchObject({
      instruction: "Tighten the conclusion.",
      canSubmit: true,
    });
    expect(
      revisionComposerState({
        comments,
        selectedIds: [],
        instruction: "  ",
        canCompose: true,
      }).canSubmit,
    ).toBe(false);
  });

  it("never enables the Owner composer for a role without both capabilities", () => {
    expect(
      revisionComposerState({
        comments,
        selectedIds: ["open-a"],
        instruction: "",
        canCompose: false,
      }),
    ).toMatchObject({
      canSubmit: false,
      reason: "Only the Owner can request a revision.",
    });
  });
});

describe("durable request status", () => {
  it.each([
    ["submitted", true],
    ["running", false],
    ["returned", false],
    ["failed", true],
    ["expired", true],
    ["conflicted", false],
  ])("describes %s and its retry eligibility", (status, canInvoke) => {
    expect(revisionRequestStatus({ status })).toMatchObject({
      status,
      canInvoke,
    });
  });

  it("does not start a second invocation while an external attempt is submitted", () => {
    expect(
      revisionRequestStatus({ status: "submitted", attempt: 1 }).canInvoke,
    ).toBe(false);
  });

  it("uses a persisted failure explanation", () => {
    expect(
      revisionRequestStatus({ status: "failed", error: "Host timed out" }),
    ).toMatchObject({ detail: "Host timed out", canInvoke: true });
    expect(
      revisionRequestStatus({
        status: "failed",
        error: "agent_invocation_timeout",
      }).detail,
    ).toContain("timed out");
  });
});

it("creates a revision handoff prompt bound to durable request fields", () => {
  const prompt = agentHandoffPrompt(
    "revision-request",
    `https://viewer.example/?handoff=11111111-1111-4111-8111-111111111111#${"a".repeat(64)}`,
  );
  expect(prompt).toContain("get_review_context");
  expect(prompt).toContain("requestId equal to revisionRequest.id");
  expect(prompt).toContain("exact base");
  expect(prompt).toContain("commentIds");
  expect(prompt).toContain("prescribed key");
});

describe("frozen feedback drift", () => {
  const snapshot = {
    id: "comment-1",
    body: "Clarify this",
    status: "open",
    replies: [],
  };

  it("distinguishes newer discussion from unchanged feedback", () => {
    expect(feedbackDrift(snapshot, { ...snapshot })).toEqual({
      changed: false,
      kind: "same",
      message: "",
    });
    expect(
      feedbackDrift(snapshot, {
        ...snapshot,
        replies: [
          {
            id: "reply-1",
            body: "Use the shorter name",
            author: "owner",
            createdAt: "2026-09-04T12:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ changed: true, kind: "discussion" });
  });

  it("calls out resolution while preserving the submitted snapshot", () => {
    expect(
      feedbackDrift(snapshot, { ...snapshot, status: "resolved" }),
    ).toMatchObject({ changed: true, kind: "resolved" });
  });
});

describe("comment to proposal changes navigation", () => {
  const proposal = {
    diff: {
      elements: [{ id: "intro" }],
      files: [{ path: "styles.css" }, { path: "document.html" }],
    },
  };

  it("prefers document.html when the comment target element changed", () => {
    expect(
      proposalChangeDestination(proposal, { target: { element: "intro" } }),
    ).toMatchObject({ mapped: true, path: "document.html" });
  });

  it("labels the fallback when no exact local change is established", () => {
    expect(
      proposalChangeDestination(proposal, { target: { element: "other" } }),
    ).toMatchObject({ mapped: false, path: "document.html" });
  });
});
