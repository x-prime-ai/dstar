import type { Server } from "node:http";
import type { ActorIdentity, RevisionRequest } from "@dstar/core";

export interface ViewerAgentFile {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}

export interface ViewerAgentInvocationContext {
  documentId: string;
  request: Omit<RevisionRequest, "key" | "command">;
  base: {
    revision: string | null;
    files: ViewerAgentFile[];
  };
}

export interface ViewerAgentInvocation {
  identity: ActorIdentity & { role: "agent" };
  timeoutMs?: number;
  invoke(
    context: ViewerAgentInvocationContext,
    options: { signal: AbortSignal },
  ): Promise<{ files: ViewerAgentFile[] }>;
}

export interface ViewerOptions {
  host?: string;
  externalOrigin?: string;
  basePath?: string;
  ownerToken?: string;
  ownerTokenFile?: string;
  reviewerToken?: string;
  reviewerTokenFile?: string;
  ownerDisplayName?: string;
  reviewerDisplayName?: string;
  workspaceManagementUrl?: string;
  /** Trusted-host callback. Core never invokes agents or receives credentials. */
  agentInvocation?: ViewerAgentInvocation;
}

export interface StartedViewer {
  server: Server;
  origin: string;
  baseUrl: string;
  /** Credential-free readiness endpoint containing no document metadata. */
  healthUrl: string;
  documentId: string;
  ownerUrl: string;
  reviewerUrl?: string;
}

export function startViewer(
  packageRoot: string,
  port?: number,
  options?: ViewerOptions,
): Promise<StartedViewer>;
