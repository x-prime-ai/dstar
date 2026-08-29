export type Files = Map<string, Buffer>;
export interface ActorIdentity {
  id: string;
  displayName: string;
  role: "owner" | "reviewer" | "agent";
}
/** String actors remain readable for pre-identity state and non-Viewer callers. */
export type Actor = ActorIdentity | string;
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
export type TextRangeSelector = {
  type: "text-range";
  start: number;
  end: number;
  unit: "unicode-code-point";
  exact: string;
  prefix?: string;
  suffix?: string;
};
export type Target = {
  revision: string;
  element: string;
  selector:
    | { type: "element" }
    | TextRangeSelector
    | {
        type: "text-ranges";
        ranges: (Omit<TextRangeSelector, "type"> & { element: string })[];
      };
};
export type Resolution = {
  status: "exact" | "recovered" | "ambiguous" | "orphaned";
  start?: number;
  end?: number;
  ranges?: (Resolution & { element: string })[];
};
export interface Comment {
  id: string;
  target: Target;
  body: string;
  author: Actor;
  createdAt: string;
  status: "open" | "resolved";
  resolvedAt?: string;
  resolvedBy?: Actor;
  replies: {
    id: string;
    author: Actor;
    body: string;
    createdAt: string;
    key?: string;
  }[];
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
  /** Persistent annotation/comment IDs that motivated this proposal. */
  motivatedBy?: string[];
  author: Actor;
  createdAt: string;
  status: "pending" | "accepted" | "rejected";
  changes: FileChange[];
  diff: ReviewDiff;
  key: string;
  command: string;
  decision?: { actor: Actor; at: string; action: "accept" | "reject" };
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
