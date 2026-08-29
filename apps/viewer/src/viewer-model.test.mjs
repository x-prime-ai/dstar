import { describe, expect, it } from "vitest";
import {
  actorCopy,
  changeSummary,
  technicalVersion,
  versionCopy,
  versionGroups,
  versionKind,
} from "../public/viewer-model.js";

const accepted = {
    id: "accepted",
    status: "accepted",
    request: "Initial version",
    revision: `sha256:${"a".repeat(64)}`,
    base: null,
    diff: { files: [{ path: "document.html" }], elementChangeCount: 2 },
  },
  earlier = { ...accepted, id: "earlier", request: "Earlier version" },
  suggested = {
    ...accepted,
    id: "suggested",
    status: "pending",
    parent: "accepted",
    request: "Clarify the opening",
    revision: `sha256:${"b".repeat(64)}`,
    base: `sha256:${"a".repeat(64)}`,
  },
  declined = { ...suggested, id: "declined", status: "rejected" },
  state = {
    head: "accepted",
    proposals: [earlier, accepted, suggested, declined],
  };

describe("viewer information architecture", () => {
  it("groups the version model into user-facing sections", () => {
    expect(versionGroups(state)).toEqual({
      suggested: [suggested],
      current: accepted,
      previous: [earlier],
      declined: [declined],
    });
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
