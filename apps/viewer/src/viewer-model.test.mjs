import { describe, expect, it } from "vitest";
import {
  actorCopy,
  changeSummary,
  technicalVersion,
  versionCopy,
  versionList,
  versionKind,
} from "../public/viewer-model.js";

const accepted = {
    id: "accepted",
    status: "accepted",
    request: "Initial version",
    createdAt: "2026-08-02T12:00:00.000Z",
    revision: `sha256:${"a".repeat(64)}`,
    base: null,
    diff: { files: [{ path: "document.html" }], elementChangeCount: 2 },
  },
  earlier = {
    ...accepted,
    id: "earlier",
    request: "Earlier version",
    createdAt: "2026-08-01T12:00:00.000Z",
  },
  suggested = {
    ...accepted,
    id: "suggested",
    status: "pending",
    parent: "accepted",
    request: "Clarify the opening",
    createdAt: "2026-08-03T12:00:00.000Z",
    revision: `sha256:${"b".repeat(64)}`,
    base: `sha256:${"a".repeat(64)}`,
  },
  declined = {
    ...suggested,
    id: "declined",
    status: "rejected",
    createdAt: "2026-08-04T12:00:00.000Z",
  },
  state = {
    head: "accepted",
    proposals: [earlier, accepted, suggested, declined],
  };

describe("viewer information architecture", () => {
  it("presents one chronological version list", () => {
    expect(versionList(state)).toEqual([
      declined,
      suggested,
      accepted,
      earlier,
    ]);
  });

  it("describes review state without exposing base or candidate terms", () => {
    expect(versionKind(suggested, state)).toBe("suggested");
    expect(versionCopy(suggested, state)).toMatchObject({
      badge: "Suggested change",
      preview: "After changes",
      heading: "Clarify the opening",
    });
    expect(versionCopy(suggested, state, true).preview).toBe("Before changes");
    expect(versionCopy(accepted, state).badge).toBe("Current version");
    expect(versionCopy(earlier, state).badge).toBe("Previous version");
  });

  it("keeps revision identifiers in an explicit technical helper", () => {
    expect(changeSummary(suggested)).toBe("2 changed elements in 1 file");
    expect(technicalVersion(suggested)).toBe(
      "Revision bbbbbbbbbbbb · compared with aaaaaaaaaaaa",
    );
  });

  it("renders structured identities and safely preserves legacy actors", () => {
    expect(actorCopy({ displayName: "Avery", role: "owner" })).toEqual({
      name: "Avery",
      role: "Owner",
    });
    expect(actorCopy("legacy-agent")).toEqual({
      name: "legacy-agent",
      role: null,
    });
  });
});
