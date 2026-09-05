export type Files = Map<string, Buffer>;
export interface ActorIdentity {
  id: string;
  displayName: string;
  /** Host-defined audit label; Core does not use it for authorization. */
  role: string;
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
  /** Durable revision request that produced this proposal, when applicable. */
  requestId?: string;
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
export type RevisionRequestStatus =
  "submitted" | "running" | "returned" | "failed" | "expired" | "conflicted";
export type RevisionRequestFeedback = Pick<
  Comment,
  "id" | "target" | "body" | "author" | "createdAt" | "replies" | "status"
>;
export interface RevisionRequest {
  id: string;
  /** Exact accepted revision captured when the request was submitted. */
  base: string | null;
  /** Owner-supplied whole-request instruction; empty for comments-only requests. */
  instruction: string;
  /** Nonempty canonical prose used by a linked Proposal. */
  request: string;
  commentIds: string[];
  /** Immutable submitted feedback, independent of later discussion changes. */
  feedback: RevisionRequestFeedback[];
  requester: Actor;
  createdAt: string;
  key: string;
  command: string;
  status: RevisionRequestStatus;
  /** Monotonically increasing invocation number; zero means not yet invoked. */
  attempt: number;
  /** Host/external-agent identity for the latest invocation. */
  attemptId?: string;
  updatedAt: string;
  error?: string;
  proposalId?: string;
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
  revisionRequests: RevisionRequest[];
}
export interface Snapshot {
  state: State;
  stateId: string;
  revision: string | null;
  files: Files;
  index: HtmlIndex | null;
}

export interface ProposeInput {
  candidate: string;
  base: string | null;
  request: string;
  author: Actor;
  key: string;
  commentIds?: string[];
  requestId?: string;
  attemptId?: string;
}

export interface CreateRevisionRequestInput {
  base: string | null;
  instruction?: string;
  commentIds?: string[];
  requester: Actor;
  key: string;
}

export interface UpdateRevisionRequestInput {
  status: "submitted" | "running" | "failed" | "expired" | "conflicted";
  attemptId: string;
  error?: string;
  expectedStateId?: string;
}

export interface CommentInput {
  target: Target;
  body: string;
  author: Actor;
}

export interface ExportResult {
  revision: string | null;
  directory: string;
}

/** Complete filesystem-backed DSTAR document API. */
export interface DstarDocument {
  snapshot(revisionOrProposalId?: string): Snapshot;
  propose(input: ProposeInput): Proposal;
  createRevisionRequest(input: CreateRevisionRequestInput): RevisionRequest;
  updateRevisionRequest(
    requestId: string,
    input: UpdateRevisionRequestInput,
  ): RevisionRequest;
  comment(input: CommentInput): Comment;
  reply(
    commentId: string,
    body: string,
    author: Actor,
    key?: string,
    expectedStateId?: string,
  ): Comment;
  export(directory: string, revisionOrProposalId?: string): ExportResult;
  decide(
    proposalId: string,
    action: "accept" | "reject",
    expectedRevision: string,
    expectedStateId: string,
    actor: Actor,
  ): Proposal;
  resolveComment(
    commentId: string,
    expectedStateId: string,
    actor?: Actor,
  ): Comment;
}
