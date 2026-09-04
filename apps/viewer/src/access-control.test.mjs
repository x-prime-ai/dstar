import { expect, it } from "vitest";
import {
  CAPABILITIES,
  capabilitiesForRole,
  handoffPrincipal,
  hasCapability,
  publicPrincipal,
  requireCapability,
  routeCapability,
} from "./access-control.mjs";

const identity = (role) => ({ id: role, displayName: role, role });
const principal = (role) => ({
  role,
  identity: identity(role),
  capabilities: capabilitiesForRole(role),
});

it("keeps document updates, decisions, resolution and sharing owner-only", () => {
  const owner = principal("owner"),
    reviewer = principal("reviewer");
  for (const capability of ["propose", "decide", "resolve", "share"])
    expect(hasCapability(owner, capability)).toBe(true);
  for (const capability of ["read", "comment", "handoff", "reply"])
    expect(hasCapability(reviewer, capability)).toBe(true);
  for (const capability of ["propose", "decide", "resolve", "share"]) {
    expect(hasCapability(reviewer, capability)).toBe(false);
    expect(() => requireCapability(reviewer, capability)).toThrow();
  }
});

it("classifies current and integration routes through one reusable gate", () => {
  const document = "/api/documents/22222222-2222-4222-8222-222222222222";
  expect(routeCapability("POST", `${document}/proposals`)).toBe("propose");
  expect(routeCapability("POST", `${document}/comments`)).toBe("comment");
  expect(routeCapability("POST", "/api/handoffs")).toBe("handoff");
  expect(
    routeCapability(
      "POST",
      "/api/handoffs/11111111-1111-4111-8111-111111111111/revoke",
    ),
  ).toBe("handoff");
  expect(
    routeCapability(
      "POST",
      "/api/handoffs/11111111-1111-4111-8111-111111111111/reply-draft",
    ),
  ).toBe("reply");
  expect(
    routeCapability(
      "POST",
      `${document}/comments/11111111-1111-4111-8111-111111111111/replies`,
    ),
  ).toBe("reply");
  expect(
    routeCapability(
      "POST",
      `${document}/comments/11111111-1111-4111-8111-111111111111/resolve`,
    ),
  ).toBe("resolve");
  expect(
    routeCapability(
      "POST",
      `${document}/proposals/11111111-1111-4111-8111-111111111111/accept`,
    ),
  ).toBe("decide");
  expect(routeCapability("POST", "/api/comments")).toBeUndefined();
  expect(routeCapability("POST", "/api/webmcp/reply")).toBeUndefined();
});

it("intersects handoff authority and exposes no credentials", () => {
  const creator = principal("reviewer"),
    handoff = handoffPrincipal(creator, [
      CAPABILITIES.READ,
      CAPABILITIES.PROPOSE,
      CAPABILITIES.DECIDE,
    ]);
  expect(handoff.capabilities).toEqual(["read"]);
  expect(publicPrincipal(handoff)).toEqual({
    role: "reviewer",
    identity: creator.identity,
    capabilities: ["read"],
  });
  expect(JSON.stringify(publicPrincipal(handoff))).not.toMatch(
    /token|credential/i,
  );
});
