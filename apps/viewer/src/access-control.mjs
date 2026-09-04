import { authorized } from "./runtime-config.mjs";

export const CAPABILITIES = Object.freeze({
  READ: "read",
  COMMENT: "comment",
  PROPOSE: "propose",
  HANDOFF: "handoff",
  REPLY: "reply",
  DECIDE: "decide",
  RESOLVE: "resolve",
  SHARE: "share",
});

const roleCapabilities = Object.freeze({
  owner: Object.freeze(Object.values(CAPABILITIES)),
  reviewer: Object.freeze([
    CAPABILITIES.READ,
    CAPABILITIES.COMMENT,
    CAPABILITIES.HANDOFF,
    CAPABILITIES.REPLY,
  ]),
  agent: Object.freeze([
    CAPABILITIES.READ,
    CAPABILITIES.PROPOSE,
    CAPABILITIES.REPLY,
  ]),
});

const routeRules = Object.freeze([
  ["GET", /^\/api\//, CAPABILITIES.READ],
  ["POST", /^\/api\/documents\/[a-f0-9-]{36}\/comments$/, CAPABILITIES.COMMENT],
  ["POST", /^\/api\/handoffs$/, CAPABILITIES.HANDOFF],
  ["POST", /^\/api\/handoffs\/[a-f0-9-]{36}\/draft$/, CAPABILITIES.HANDOFF],
  ["POST", /^\/api\/handoffs\/[a-f0-9-]{36}\/revoke$/, CAPABILITIES.HANDOFF],
  ["POST", /^\/api\/handoffs\/[a-f0-9-]{36}\/reply-draft$/, CAPABILITIES.REPLY],
  [
    "POST",
    /^\/api\/documents\/[a-f0-9-]{36}\/comments\/[a-f0-9-]{36}\/replies$/,
    CAPABILITIES.REPLY,
  ],
  [
    "POST",
    /^\/api\/documents\/[a-f0-9-]{36}\/comments\/[a-f0-9-]{36}\/resolve$/,
    CAPABILITIES.RESOLVE,
  ],
  [
    "POST",
    /^\/api\/documents\/[a-f0-9-]{36}\/proposals\/[a-f0-9-]{36}\/(accept|reject)$/,
    CAPABILITIES.DECIDE,
  ],
  [
    "POST",
    /^\/api\/documents\/[a-f0-9-]{36}\/review-context$/,
    CAPABILITIES.READ,
  ],
  [
    "GET",
    /^\/api\/documents\/[a-f0-9-]{36}\/revisions\/sha256:[a-f0-9]{64}\/files$/,
    CAPABILITIES.READ,
  ],
  [
    "POST",
    /^\/api\/documents\/[a-f0-9-]{36}\/proposals$/,
    CAPABILITIES.PROPOSE,
  ],
]);

export function capabilitiesForRole(role) {
  return roleCapabilities[role] ?? Object.freeze([]);
}

export function hasCapability(principal, capability) {
  return Boolean(principal?.capabilities?.includes(capability));
}

export function requireCapability(principal, capability) {
  if (!hasCapability(principal, capability)) {
    const error = new Error(
      `This ${principal?.role ?? "session"} cannot ${capability}`,
    );
    error.code = "forbidden";
    error.status = 403;
    throw error;
  }
}

export function routeCapability(method, path) {
  return routeRules.find(
    ([expectedMethod, pattern]) =>
      expectedMethod === method && pattern.test(path),
  )?.[2];
}

export function sessionPrincipal(req, config) {
  for (const role of ["owner", "reviewer"]) {
    const credential = config.credentials[role];
    if (credential && authorized(req, credential.token)) {
      return Object.freeze({
        kind: "session",
        role,
        identity: credential.identity,
        capabilities: capabilitiesForRole(role),
      });
    }
  }
  return null;
}

export function handoffPrincipal(creator, allowed) {
  const capabilities = Object.freeze(
    [...new Set(allowed)].filter((capability) =>
      hasCapability(creator, capability),
    ),
  );
  return Object.freeze({
    kind: "handoff",
    role: creator.role,
    identity: creator.identity,
    capabilities,
  });
}

export function publicPrincipal(principal) {
  return {
    role: principal.role,
    identity: principal.identity,
    capabilities: [...principal.capabilities],
  };
}
