import { Repository } from "./repository.js";
import type { DstarHost } from "./types.js";

/**
 * Open the trusted-host authority surface.
 *
 * The caller is responsible for authenticating and authorizing the human actor.
 * Agent-facing integrations should use `open` from the package root instead.
 */
export function openHost(root: string): DstarHost {
  const repo = new Repository(root);
  return {
    decide: repo.decide.bind(repo),
    resolveComment: repo.resolveComment.bind(repo),
  };
}
