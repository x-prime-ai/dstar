import { Repository } from "./repository.js";
export type * from "./types.js";
export { readCandidate } from "./repository.js";
export { revision, digest } from "./delta.js";
export {
  validateHtml,
  validateTarget,
  resolveTarget,
  mediaType,
} from "./html.js";
// The agent surface intentionally has no accept/reject/resolve entry point.
export function open(root: string) {
  const repo = new Repository(root);
  return {
    snapshot: repo.snapshot.bind(repo),
    propose: repo.propose.bind(repo),
    comment: repo.comment.bind(repo),
    reply: repo.reply.bind(repo),
    export: repo.export.bind(repo),
  };
}
