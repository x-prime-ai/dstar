import { Repository } from "./repository.js";
import type { DstarDocument } from "./types.js";
export type * from "./types.js";
export { readCandidate } from "./repository.js";
export { revision, digest } from "./delta.js";
export { replaceTargetText } from "./suggestion.js";
export {
  validateHtml,
  validateTarget,
  resolveTarget,
  mediaType,
  filePath,
} from "./html.js";
export function openDocument(root: string): DstarDocument {
  const repo = new Repository(root);
  return {
    snapshot: repo.snapshot.bind(repo),
    propose: repo.propose.bind(repo),
    comment: repo.comment.bind(repo),
    reply: repo.reply.bind(repo),
    export: repo.export.bind(repo),
    decide: repo.decide.bind(repo),
    resolveComment: repo.resolveComment.bind(repo),
  };
}
