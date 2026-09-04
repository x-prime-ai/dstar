import type { Server } from "node:http";

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
}

export interface StartedViewer {
  server: Server;
  origin: string;
  baseUrl: string;
  documentId: string;
  ownerUrl: string;
  reviewerUrl?: string;
}

export function startViewer(
  packageRoot: string,
  port?: number,
  options?: ViewerOptions,
): Promise<StartedViewer>;
