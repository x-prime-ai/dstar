export const NODE_SDK_STABILITY = "experimental" as const;

export interface NodeRuntimeBoundary {
  readonly platform: "node";
  readonly filesystemAccess: true;
}

export function describeNodeRuntimeBoundary(): NodeRuntimeBoundary {
  return Object.freeze({ platform: "node", filesystemAccess: true });
}
