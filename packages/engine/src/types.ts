export type Files = Map<string, Buffer>;
export interface ElementInfo {
  id: string;
  tag: string;
  parent: string | null;
  order: number;
  text: string;
  attributes: Record<string, string>;
}
export interface HtmlIndex {
  elements: Record<string, ElementInfo>;
  title: string;
}
export type Target = {
  revision: string;
  element: string;
  selector:
    | { type: "element" }
    | {
        type: "text-range";
        start: number;
        end: number;
        unit: "unicode-code-point";
        exact: string;
        prefix?: string;
        suffix?: string;
      };
};
export type Resolution = {
  status: "exact" | "recovered" | "ambiguous" | "orphaned";
  start?: number;
  end?: number;
};
export interface Comment {
  id: string;
  target: Target;
  body: string;
  author: string;
  createdAt: string;
  status: "open" | "resolved";
  replies: { id: string; author: string; body: string; createdAt: string }[];
}
export interface Storage {
  encoding: "gzip-blob" | "gzip-delta-v1";
  object: string;
  size: number;
}
export interface FileChange {
  path: string;
  base: string | null;
  result: string | null;
  resultSize: number;
  storage?: Storage;
}
export interface ReviewDiff {
  elements: {
    id: string;
    changes: string[];
    before: ElementPreview | null;
    after: ElementPreview | null;
  }[];
  elementChangeCount: number;
  files: {
    path: string;
    kind: "added" | "modified" | "removed";
    beforeBytes: number;
    afterBytes: number;
  }[];
  rewriteRatio: number;
  anchorRisks: { comment: string; status: Resolution["status"] }[];
}
export interface Proposal {
  id: string;
  base: string | null;
  parent: string | null;
  revision: string;
  request: string;
  author: string;
  createdAt: string;
  status: "pending" | "accepted" | "rejected";
  changes: FileChange[];
  diff: ReviewDiff;
  key: string;
  command: string;
  decision?: { actor: string; at: string; action: "accept" | "reject" };
  checkpoint?: {
    path: string;
    digest: string;
    size: number;
    storage: Storage;
  }[];
}
export interface ElementPreview {
  tag: string;
  parent: string | null;
  order: number;
  text: string;
  textLength: number;
  textHash: string;
}
export interface State {
  format: "dstar-html-0.2-dev";
  id: string;
  generation: number;
  head: string | null;
  proposals: Proposal[];
  comments: Comment[];
}
export interface Snapshot {
  state: State;
  stateId: string;
  revision: string | null;
  files: Files;
  index: HtmlIndex | null;
}
