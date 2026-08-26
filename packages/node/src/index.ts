export const NODE_SDK_STABILITY = "experimental" as const;

export * from "./package.js";
export * from "./repository.js";
export * from "./commands.js";

export interface NodeRuntimeBoundary {
  readonly platform: "node";
  readonly filesystemAccess: true;
}

export function describeNodeRuntimeBoundary(): NodeRuntimeBoundary {
  return Object.freeze({ platform: "node", filesystemAccess: true });
}
