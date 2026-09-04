import {
  openDocument as openCoreDocument,
  type ActorIdentity,
  type DstarDocument,
} from "@dstar/core";
import { createDstarMcpServer, type DstarMcpCapability } from "@dstar/mcp";
import {
  startViewer,
  type StartedViewer,
  type ViewerOptions,
} from "@dstar/viewer";

export interface HostViewerConfig extends ViewerOptions {
  packageRoot: string;
  port?: number;
}

/** Open the complete document API inside the product's trusted server. */
export function openDocument(packageRoot: string): DstarDocument {
  return openCoreDocument(packageRoot);
}

export function createDocumentMcp(
  packageRoot: string,
  actor: ActorIdentity,
  capabilities: readonly DstarMcpCapability[],
) {
  return createDstarMcpServer({
    document: openCoreDocument(packageRoot),
    actor,
    capabilities,
  });
}

/** Start the complete Viewer behind the integrating product's own origin. */
export function serveDocument(
  config: HostViewerConfig,
): Promise<StartedViewer> {
  const { packageRoot, port = 0, ...options } = config;
  return startViewer(packageRoot, port, options);
}
