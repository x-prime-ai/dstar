import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import {
  filePath,
  validateHtml,
  type ActorIdentity,
  type Comment,
  type DstarDocument,
  type Files,
  type Proposal,
  type RevisionRequest,
  type Target,
} from "@dstar/core";
import * as z from "zod/v4";

export type DstarMcpCapability =
  "read" | "propose" | "comment" | "reply" | "decide" | "resolve";

export interface DstarMcpOptions {
  document: DstarDocument;
  /** Identity derived from the MCP host's authenticated session. */
  actor: ActorIdentity;
  /** Tools to expose to this MCP caller. No capability is implicit. */
  capabilities: readonly DstarMcpCapability[];
}

export interface DstarMcpServerInfo {
  name?: string;
  version?: string;
}

const HASH = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const stateId = z.string().regex(HASH);
const revision = z.string().regex(HASH);
const textRange = z
  .object({
    type: z.literal("text-range"),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    unit: z.literal("unicode-code-point"),
    exact: z.string(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
  })
  .strict();
const target = z
  .object({
    revision,
    element: z.string().min(1),
    selector: z.union([
      z.object({ type: z.literal("element") }).strict(),
      textRange,
      z
        .object({
          type: z.literal("text-ranges"),
          ranges: z
            .array(
              textRange.omit({ type: true }).extend({
                element: z.string().min(1),
              }),
            )
            .min(1),
        })
        .strict(),
    ]),
  })
  .strict();
const submittedFile = z
  .object({
    path: z.string().min(1).max(240),
    encoding: z.enum(["utf8", "base64"]),
    content: z.string().max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4),
  })
  .strict();

function publicProposal(proposal: Proposal): Record<string, unknown> {
  return {
    id: proposal.id,
    base: proposal.base,
    parent: proposal.parent,
    revision: proposal.revision,
    request: proposal.request,
    ...(proposal.requestId ? { requestId: proposal.requestId } : {}),
    motivatedBy: proposal.motivatedBy ?? [],
    author: proposal.author,
    createdAt: proposal.createdAt,
    status: proposal.status,
    diff: proposal.diff,
    ...(proposal.decision ? { decision: proposal.decision } : {}),
  };
}

function publicRevisionRequest(
  request: RevisionRequest,
): Record<string, unknown> {
  return {
    id: request.id,
    base: request.base,
    instruction: request.instruction,
    request: request.request,
    commentIds: request.commentIds,
    feedback: request.feedback.map(publicComment),
    requester: request.requester,
    createdAt: request.createdAt,
    status: request.status,
    attempt: request.attempt,
    ...(request.attemptId ? { attemptId: request.attemptId } : {}),
    updatedAt: request.updatedAt,
    ...(request.error ? { error: request.error } : {}),
    ...(request.proposalId ? { proposalId: request.proposalId } : {}),
  };
}

function publicComment(comment: Comment): Record<string, unknown> {
  return {
    id: comment.id,
    target: comment.target,
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
    status: comment.status,
    ...(comment.resolvedAt ? { resolvedAt: comment.resolvedAt } : {}),
    ...(comment.resolvedBy ? { resolvedBy: comment.resolvedBy } : {}),
    replies: comment.replies.map(({ id, author, body, createdAt }) => ({
      id,
      author,
      body,
      createdAt,
    })),
  };
}

function filesFromInput(
  input: readonly z.infer<typeof submittedFile>[],
): Files {
  if (input.length < 1 || input.length > 512)
    throw new Error("Candidate must contain between 1 and 512 files");
  const files: Files = new Map();
  const folded = new Set<string>();
  const directorySpellings = new Map<string, string>();
  let total = 0;
  for (const file of input) {
    filePath(file.path);
    const lower = file.path.toLowerCase();
    if (folded.has(lower))
      throw new Error("Duplicate or case-colliding candidate path");
    folded.add(lower);
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const prefix = parts.slice(0, index).join("/");
      const foldedPrefix = prefix.toLowerCase();
      if (
        directorySpellings.has(foldedPrefix) &&
        directorySpellings.get(foldedPrefix) !== prefix
      )
        throw new Error("Case-colliding candidate directory path");
      directorySpellings.set(foldedPrefix, prefix);
    }
    const text = /\.(html|css)$/.test(file.path);
    if (file.encoding !== (text ? "utf8" : "base64"))
      throw new Error("HTML/CSS require utf8; assets require base64");
    const bytes = Buffer.from(file.content, file.encoding);
    if (bytes.toString(file.encoding) !== file.content)
      throw new Error("Candidate content is not canonically encoded");
    total += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES)
      throw new Error("Candidate exceeds the MCP size limit");
    files.set(file.path, bytes);
  }
  for (const path of folded) {
    const parts = path.split("/");
    while (parts.length > 1) {
      parts.pop();
      if (folded.has(parts.join("/")))
        throw new Error("Candidate file/directory path collision");
    }
  }
  validateHtml(files);
  return files;
}

function withCandidate<T>(files: Files, call: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "dstar-mcp-"));
  try {
    for (const [path, bytes] of files) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    }
    return call(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function success(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const safe =
    /^(Stale|Unknown|No content changes|Idempotency|Invalid|Candidate|HTML\/CSS|Package resource|Motivating comment|Comment)/.test(
      message,
    )
      ? message.slice(0, 500)
      : "DSTAR operation failed";
  return {
    isError: true,
    content: [{ type: "text" as const, text: safe }],
  };
}

async function call(operation: () => Record<string, unknown>) {
  try {
    return success(operation());
  } catch (error) {
    return failure(error);
  }
}

/** Register DSTAR tools on a caller-scoped MCP server instance. */
export function registerDstarTools(
  server: McpServer,
  { document, actor, capabilities }: DstarMcpOptions,
): McpServer {
  const allowed = new Set(capabilities);

  if (allowed.has("read"))
    server.registerTool(
      "dstar_get_document",
      {
        description:
          "Read current DSTAR state and files, or an exact immutable revision/proposal.",
        inputSchema: z
          .object({ reference: z.string().min(1).optional() })
          .strict(),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ reference }) =>
        call(() => {
          const snapshot = document.snapshot(reference);
          return {
            stateId: snapshot.stateId,
            revision: snapshot.revision,
            state: {
              format: snapshot.state.format,
              id: snapshot.state.id,
              generation: snapshot.state.generation,
              head: snapshot.state.head,
              proposals: snapshot.state.proposals.map(publicProposal),
              comments: snapshot.state.comments.map(publicComment),
              revisionRequests: snapshot.state.revisionRequests.map(
                publicRevisionRequest,
              ),
            },
            files: [...snapshot.files]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([path, bytes]) => ({
                path,
                encoding: /\.(html|css)$/.test(path) ? "utf8" : "base64",
                content: bytes.toString(
                  /\.(html|css)$/.test(path) ? "utf8" : "base64",
                ),
              })),
          };
        }),
    );

  if (allowed.has("propose"))
    server.registerTool(
      "dstar_propose_revision",
      {
        description:
          "Submit a complete DSTAR candidate against an exact base revision.",
        inputSchema: z
          .object({
            base: revision.nullable(),
            request: z.string().min(1).max(20_000),
            key: z.string().min(1).max(200),
            files: z.array(submittedFile).min(1).max(512),
            commentIds: z
              .array(z.string().regex(UUID))
              .min(1)
              .max(100)
              .refine((ids) => new Set(ids).size === ids.length, {
                message: "Comment IDs must be unique",
              })
              .optional(),
            requestId: z.string().regex(UUID).optional(),
            attemptId: z.string().min(1).max(200).optional(),
          })
          .strict()
          .refine(
            ({ requestId, attemptId }) =>
              Boolean(requestId) === Boolean(attemptId),
            { message: "requestId and attemptId must be supplied together" },
          ),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ base, request, key, files, commentIds, requestId, attemptId }) =>
        call(() => {
          if (Boolean(requestId) !== Boolean(attemptId))
            throw new Error(
              "Invalid revision request link: requestId and attemptId must be supplied together",
            );
          const candidate = filesFromInput(files);
          const proposal = withCandidate(candidate, (directory) =>
            document.propose({
              candidate: directory,
              base,
              request,
              author: actor,
              key,
              ...(commentIds ? { commentIds } : {}),
              ...(requestId && attemptId ? { requestId, attemptId } : {}),
            }),
          );
          return { proposal: publicProposal(proposal) };
        }),
    );

  if (allowed.has("comment"))
    server.registerTool(
      "dstar_add_comment",
      {
        description: "Add a comment to an exact DSTAR element or text target.",
        inputSchema: z
          .object({ target, body: z.string().min(1).max(20_000) })
          .strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ target: commentTarget, body }) =>
        call(() => ({
          comment: publicComment(
            document.comment({
              target: commentTarget as Target,
              body,
              author: actor,
            }),
          ),
        })),
    );

  if (allowed.has("reply"))
    server.registerTool(
      "dstar_reply_comment",
      {
        description: "Reply to an existing DSTAR comment thread.",
        inputSchema: z
          .object({
            commentId: z.string().regex(UUID),
            body: z.string().min(1).max(20_000),
            key: z.string().min(1).max(200),
            expectedStateId: stateId,
          })
          .strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ commentId, body, key, expectedStateId }) =>
        call(() => ({
          comment: publicComment(
            document.reply(commentId, body, actor, key, expectedStateId),
          ),
        })),
    );

  if (allowed.has("decide"))
    server.registerTool(
      "dstar_decide_proposal",
      {
        description:
          "Accept or reject an exact pending DSTAR proposal after host authorization.",
        inputSchema: z
          .object({
            proposalId: z.string().regex(UUID),
            action: z.enum(["accept", "reject"]),
            expectedRevision: revision,
            expectedStateId: stateId,
          })
          .strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ proposalId, action, expectedRevision, expectedStateId }) =>
        call(() => ({
          proposal: publicProposal(
            document.decide(
              proposalId,
              action,
              expectedRevision,
              expectedStateId,
              actor,
            ),
          ),
        })),
    );

  if (allowed.has("resolve"))
    server.registerTool(
      "dstar_resolve_comment",
      {
        description:
          "Resolve an existing DSTAR comment against an exact document state after host authorization.",
        inputSchema: z
          .object({
            commentId: z.string().regex(UUID),
            expectedStateId: stateId,
          })
          .strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ commentId, expectedStateId }) =>
        call(() => ({
          comment: publicComment(
            document.resolveComment(commentId, expectedStateId, actor),
          ),
        })),
    );

  return server;
}

/** Create an MCP server with caller-scoped DSTAR tools already registered. */
export function createDstarMcpServer(
  options: DstarMcpOptions,
  info: DstarMcpServerInfo = {},
): McpServer {
  return registerDstarTools(
    new McpServer({
      name: info.name ?? "dstar",
      version: info.version ?? "0.1.0",
    }),
    options,
  );
}
