import { Repository } from "./repository.js";
/** Internal human-review adapter. Filesystem access remains a trusted-host boundary. */
export function decisions(root: string) {
  const repo = new Repository(root);
  return {
    decide: repo.decide.bind(repo),
    resolveComment: repo.resolveComment.bind(repo),
  };
}
