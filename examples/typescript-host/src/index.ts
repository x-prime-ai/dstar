import { open, type ActorIdentity, type Proposal } from "@dstar/engine";
import { openHost } from "@dstar/engine/host";
import {
  startViewer,
  type StartedViewer,
  type ViewerOptions,
} from "@dstar/viewer";

export interface HostViewerConfig extends ViewerOptions {
  packageRoot: string;
  port?: number;
}

/** Start the reference UI behind the integrating product's own origin. */
export function serveDocument(
  config: HostViewerConfig,
): Promise<StartedViewer> {
  const { packageRoot, port = 0, ...options } = config;
  return startViewer(packageRoot, port, options);
}

/**
 * Accept one pending proposal after the caller's own auth layer identifies an
 * Owner. Exact revision and state checks prevent stale UI decisions.
 */
export function acceptProposal(
  packageRoot: string,
  proposalId: string,
  owner: ActorIdentity & { role: "owner" },
): Proposal {
  const document = open(packageRoot);
  const snapshot = document.snapshot();
  const proposal = snapshot.state.proposals.find(
    (candidate) =>
      candidate.id === proposalId && candidate.status === "pending",
  );
  if (!proposal) throw new Error("Pending proposal not found");

  return openHost(packageRoot).decide(
    proposal.id,
    "accept",
    proposal.revision,
    snapshot.stateId,
    owner,
  );
}
