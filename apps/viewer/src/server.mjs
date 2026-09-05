import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  openDocument,
  mediaType,
  resolveTarget,
  validateTarget,
} from "@dstar/core";
import {
  encodedSnapshot,
  documentErrorResult,
  documentRoute,
  publicComment,
  publicProposal,
  publicRevisionRequest,
  submitCandidate,
} from "./document-api.mjs";
import { createPreviewCache } from "./preview-cache.mjs";
import { fileDiff } from "./file-diff.mjs";
import {
  authorized,
  displayName,
  resolveViewerConfig,
  trustedRequestUrl,
  viewerOrigin,
} from "./runtime-config.mjs";
import {
  CAPABILITIES,
  handoffPrincipal,
  publicPrincipal,
  requireCapability,
  routeCapability,
  sessionPrincipal,
} from "./access-control.mjs";

const publicFile = (path) =>
  readFileSync(new URL(`../public/${path}`, import.meta.url));
const secret = () => randomBytes(24).toString("hex");
const HANDOFF_TTL = 15 * 60 * 1000;
const handoffId = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const handoffToken = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{48,256}$/.test(value);
const uuid = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const exactBody = (body, keys) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== [...keys].sort().join(",")
  )
    throw new Error("Unknown or missing request fields");
};
const safeRouteError = (error) => {
  const known = {
    forbidden: "This session is not allowed to perform that action.",
    not_found: "The configured host agent or revision request was not found.",
    attempt_conflict:
      "A revision request attempt is already active or has been superseded.",
  };
  if (
    error?.code in known &&
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status < 500
  )
    return { status: error.status, code: error.code, error: known[error.code] };
  return documentErrorResult(error);
};
export async function startViewer(root, port = 0, options = {}) {
  const configuredInvocation =
    options && typeof options === "object" && !Array.isArray(options)
      ? options.agentInvocation
      : undefined;
  const viewerOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? { ...options }
      : options;
  if (viewerOptions && typeof viewerOptions === "object")
    delete viewerOptions.agentInvocation;
  const config = resolveViewerConfig(root, port, viewerOptions);
  let agentInvocation = null;
  if (configuredInvocation !== undefined) {
    if (
      !configuredInvocation ||
      typeof configuredInvocation !== "object" ||
      Array.isArray(configuredInvocation) ||
      !["identity", "invoke"].every((key) => key in configuredInvocation) ||
      !Object.keys(configuredInvocation).every((key) =>
        ["identity", "invoke", "timeoutMs"].includes(key),
      )
    )
      throw new Error("Invalid trusted host agent invocation");
    const identity = configuredInvocation.identity;
    if (
      !identity ||
      typeof identity !== "object" ||
      Array.isArray(identity) ||
      Object.keys(identity).sort().join(",") !== "displayName,id,role" ||
      typeof configuredInvocation.invoke !== "function" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(identity.id) ||
      identity.role !== "agent" ||
      typeof identity.displayName !== "string" ||
      displayName(identity.displayName, "agent") !== identity.displayName
    )
      throw new Error("Invalid trusted host agent invocation");
    const timeoutMs = configuredInvocation.timeoutMs ?? 60_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000)
      throw new Error("agentInvocation timeoutMs must be 100–300000");
    agentInvocation = Object.freeze({
      identity: Object.freeze({ ...identity }),
      invoke: configuredInvocation.invoke,
      timeoutMs,
    });
  }
  const document = openDocument(config.root),
    engine = document,
    review = document;
  // In-memory handoffs and hook processes cannot survive a Viewer restart.
  // Reconcile only attempts whose process-local executor is necessarily gone;
  // the durable request and frozen feedback remain available for explicit retry.
  for (const request of engine.snapshot().state.revisionRequests) {
    if (!request.attemptId) continue;
    if (request.status === "running")
      engine.updateRevisionRequest(request.id, {
        status: "failed",
        attemptId: request.attemptId,
        error: "agent_invocation_interrupted",
      });
    else if (request.status === "submitted")
      engine.updateRevisionRequest(request.id, {
        status: "expired",
        attemptId: request.attemptId,
        error: "external_handoff_interrupted",
      });
  }
  const documentId = engine.snapshot().state.id,
    documentBase = `/api/documents/${documentId}`;
  const capabilities = createPreviewCache(),
    handoffs = new Map(),
    activeInvocations = new Map();
  const expireRevisionHandoff = (handoff) => {
    if (handoff?.context.action.kind !== "revision-request") return;
    try {
      engine.updateRevisionRequest(handoff.context.action.requestId, {
        status: "expired",
        attemptId: handoff.context.action.attemptId,
        error: "external_handoff_expired",
      });
    } catch {
      // A newer attempt or returned proposal owns the durable request now.
    }
  };
  const discardHandoff = (id, expire = false) => {
    const handoff = handoffs.get(id);
    if (!handoff) return null;
    handoffs.delete(id);
    if (handoff.expirationTimer)
      globalThis.clearTimeout(handoff.expirationTimer);
    if (expire) expireRevisionHandoff(handoff);
    return handoff;
  };
  const getHandoff = (id) => {
    const handoff = handoffs.get(id);
    if (!handoff) return null;
    if (handoff.expiresAt <= Date.now()) {
      discardHandoff(id, true);
      return null;
    }
    return handoff;
  };
  const publicHandoff = ({
    context,
    draft,
    replyDraft,
    expiresAt,
    principal,
  }) => ({
    context,
    draft,
    replyDraft,
    expiresAt,
    session: publicPrincipal(principal),
  });
  const authorizedHandoff = (req) => {
    for (const [id] of handoffs) {
      const handoff = getHandoff(id);
      if (handoff && authorized(req, handoff.accessToken))
        return { id, handoff };
    }
    return null;
  };
  const validateHandoffContext = (context) => {
    const selection = context?.selection,
      action = context?.action,
      viewed = context?.review;
    if (action?.kind === "revision-request") {
      const current = engine.snapshot(),
        request = current.state.revisionRequests.find(
          (entry) => entry.id === action.requestId,
        );
      if (
        !request ||
        request.status === "returned" ||
        context.review !== null ||
        context.selection !== null ||
        context.focusedCommentId !== null ||
        !uuid(action.attemptId) ||
        action.target !== undefined ||
        action.commentId !== undefined ||
        action.draft !== undefined
      )
        throw new Error("Invalid revision request handoff context");
      return {
        context: JSON.parse(JSON.stringify(context)),
        stateId: current.stateId,
        headRevision: request.base,
        allowedRevisions: request.base ? [request.base] : [],
      };
    }
    if (action?.kind === "address-comment") {
      const current = engine.snapshot(),
        comment = current.state.comments.find(
          (entry) => entry.id === action.commentId,
        );
      if (
        !comment ||
        comment.status !== "open" ||
        context.focusedCommentId !== comment.id ||
        selection !== null ||
        JSON.stringify(action.target) !== JSON.stringify(comment.target) ||
        action.draft !== ""
      )
        throw new Error("Invalid focused comment handoff context");
      const original = engine.snapshot(comment.target.revision);
      if (!original.index)
        throw new Error("Focused comment revision is unavailable");
      validateTarget(original.index, comment.target);
      if (viewed) {
        const proposal = current.state.proposals.find(
          (candidate) => candidate.id === viewed.proposalId,
        );
        if (
          !proposal ||
          viewed.previewStatus !== "ready" ||
          (viewed.showingBase
            ? proposal.base !== viewed.revision
            : proposal.revision !== viewed.revision)
        )
          throw new Error("Focused comment handoff review changed");
      }
      return {
        context: JSON.parse(JSON.stringify(context)),
        stateId: current.stateId,
        headRevision: current.revision,
        allowedRevisions: [comment.target.revision, current.revision].filter(
          (revision, index, values) =>
            revision !== null && values.indexOf(revision) === index,
        ),
      };
    }
    if (
      !selection ||
      !action ||
      !viewed ||
      action.kind !== "comment" ||
      JSON.stringify(action.target) !== JSON.stringify(selection) ||
      viewed.revision !== selection.revision ||
      viewed.previewStatus !== "ready" ||
      typeof action.draft !== "string" ||
      action.draft.length > 20000
    )
      throw new Error("Invalid agent handoff context");
    const snapshot = engine.snapshot(selection.revision);
    if (!snapshot.index) throw new Error("Handoff revision is unavailable");
    validateTarget(snapshot.index, selection);
    const proposal = engine
      .snapshot()
      .state.proposals.find((candidate) => candidate.id === viewed.proposalId);
    if (
      !proposal ||
      (viewed.showingBase
        ? proposal.base !== selection.revision
        : proposal.revision !== selection.revision)
    )
      throw new Error("Handoff review does not match the selection");
    const current = engine.snapshot();
    return {
      context: JSON.parse(JSON.stringify(context)),
      stateId: current.stateId,
      headRevision: current.revision,
      allowedRevisions: [selection.revision, current.revision].filter(
        (revision, index, values) =>
          revision !== null && values.indexOf(revision) === index,
      ),
    };
  };
  const startHostInvocation = (requestId, attemptId) => {
    if (!agentInvocation)
      throw Object.assign(new Error("No trusted host agent is configured"), {
        status: 404,
        code: "not_found",
      });
    const before = engine.snapshot(),
      request = before.state.revisionRequests.find(
        (entry) => entry.id === requestId,
      );
    if (!request)
      throw Object.assign(new Error("Unknown revision request"), {
        status: 404,
        code: "not_found",
      });
    if (request.status === "returned") {
      const proposal = before.state.proposals.find(
        (entry) => entry.id === request.proposalId,
      );
      return {
        status: 200,
        body: {
          revisionRequest: publicRevisionRequest(request),
          ...(proposal ? { proposal: publicProposal(proposal) } : {}),
        },
      };
    }
    if (
      request.attemptId !== undefined &&
      request.attemptId !== attemptId &&
      ["submitted", "running"].includes(request.status)
    )
      throw Object.assign(
        new Error("A revision request attempt is already active"),
        { status: 409, code: "attempt_conflict" },
      );
    if (request.status === "running" && request.attemptId === attemptId)
      return {
        status: 202,
        body: { revisionRequest: publicRevisionRequest(request) },
      };
    const started = engine.updateRevisionRequest(requestId, {
      status: "running",
      attemptId,
    });
    const controller = new AbortController(),
      activity = { attemptId, controller, interrupted: false };
    activeInvocations.set(requestId, activity);
    globalThis.queueMicrotask(async () => {
      let timer;
      try {
        const accepted = engine.snapshot();
        if (accepted.revision !== started.base)
          throw new Error("Stale base: revision request is conflicted");
        const base = encodedSnapshot(accepted);
        const timeout = new Promise((_, reject) => {
          timer = globalThis.setTimeout(() => {
            controller.abort();
            reject(new Error("agent_invocation_timeout"));
          }, agentInvocation.timeoutMs);
        });
        const result = await Promise.race([
          agentInvocation.invoke(
            {
              documentId,
              request: publicRevisionRequest(started),
              base,
            },
            { signal: controller.signal },
          ),
          timeout,
        ]);
        if (activity.interrupted) return;
        exactBody(result, ["files"]);
        submitCandidate(
          engine,
          {
            files: result.files,
            base: started.base,
            request: started.request,
            commentIds: started.commentIds,
            requestId: started.id,
            attemptId,
            key: `revision-request:${started.id}:${attemptId}`,
          },
          agentInvocation.identity,
        );
      } catch (error) {
        if (activity.interrupted) return;
        const result = documentErrorResult(error),
          status = ["stale_base", "comment_closed"].includes(result.code)
            ? "conflicted"
            : "failed";
        try {
          engine.updateRevisionRequest(requestId, {
            status,
            attemptId,
            error:
              error instanceof Error &&
              error.message === "agent_invocation_timeout"
                ? "agent_invocation_timeout"
                : result.code === "validation_failed"
                  ? "agent_invocation_failed"
                  : result.code,
          });
        } catch {
          // A newer attempt or returned proposal won the request-level CAS.
        }
      } finally {
        globalThis.clearTimeout(timer);
        if (activeInvocations.get(requestId)?.attemptId === attemptId)
          activeInvocations.delete(requestId);
      }
    });
    return {
      status: 202,
      body: { revisionRequest: publicRevisionRequest(started) },
    };
  };
  let origin;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = trustedRequestUrl(req, origin);
      if (!url)
        return json(403, { error: "Invalid request authority or target" });
      if (
        config.basePath &&
        url.pathname !== config.basePath &&
        !url.pathname.startsWith(`${config.basePath}/`)
      )
        return json(404, { error: "Unknown Viewer mount" });
      if (config.basePath && url.pathname === config.basePath) {
        res.writeHead(308, { Location: `${config.basePath}/${url.search}` });
        return res.end();
      }
      const path = config.basePath
        ? url.pathname.slice(config.basePath.length)
        : url.pathname;
      if (req.method === "GET" && path === "/healthz")
        return json(200, { status: "ready" });
      if (
        req.method === "GET" &&
        [
          "/",
          "/app.js",
          "/preview-state.js",
          "/review-state.js",
          "/review-rounds.js",
          "/viewer-model.js",
          "/diff-view.js",
          "/webmcp.js",
          "/session.js",
          "/style.css",
        ].includes(path)
      ) {
        res.setHeader("Origin-Agent-Cluster", "?1");
        res.setHeader("Permissions-Policy", "tools=(self)");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200, {
          "Content-Type":
            path === "/"
              ? "text/html; charset=utf-8"
              : path.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/css; charset=utf-8",
        });
        const content = publicFile(path === "/" ? "index.html" : path.slice(1));
        return res.end(
          path === "/"
            ? Buffer.from(
                content
                  .toString()
                  .replace("__DSTAR_BASE_PATH__", config.basePath),
              )
            : content,
        );
      }
      const frame = /^\/frame\/([a-f0-9]{48})\/(.+)$/.exec(path);
      if (req.method === "GET" && frame) {
        res.setHeader("Permissions-Policy", "tools=()");
        const snapshot = capabilities.get(frame[1]);
        if (!snapshot) return json(404, { error: "Expired preview; refresh" });
        const file = frame[2];
        const bytes = snapshot.files.get(file);
        if (!bytes) return json(404, { error: "Unknown canonical file" });
        const nonce = secret();
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Content-Security-Policy",
          `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}'; style-src ${origin} 'unsafe-inline'; img-src ${origin}; font-src ${origin}; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}`,
        );
        res.writeHead(200, {
          "Content-Type": `${mediaType(file)}${/\.(html|css)$/.test(file) ? "; charset=utf-8" : ""}`,
        });
        // The capability grants only immutable preview bytes, never mutation access.
        if (file === "document.html")
          return res.end(
            Buffer.concat([
              bytes,
              Buffer.from(
                `\n<script nonce="${nonce}">${publicFile("bridge.js")
                  .toString()
                  .replace(
                    "__DSTAR_CONTEXT__",
                    JSON.stringify({
                      revision: snapshot.revision,
                      capability: frame[1],
                      origin,
                      assets: [...snapshot.files.keys()]
                        .filter((path) => path.startsWith("assets/"))
                        .map((path) => ({
                          path,
                          type: mediaType(path).split("/")[0],
                        })),
                    }),
                  )}</script>`,
              ),
            ]),
          );
        return res.end(bytes);
      }
      const session = sessionPrincipal(req, config),
        scoped = session ? null : authorizedHandoff(req),
        principal = session ?? scoped?.handoff.principal;
      if (!path.startsWith("/api/") || !principal)
        return json(401, { error: "Viewer authorization required" });
      if (req.headers.origin !== undefined && req.headers.origin !== origin)
        return json(403, { error: "Invalid review origin" });
      if (
        path.startsWith("/api/documents/") &&
        !path.startsWith(`${documentBase}/`)
      )
        return json(404, { error: "Unknown document" });
      if (scoped) {
        const batch = scoped.handoff.context.action.kind === "revision-request";
        const current = engine.snapshot();
        const request = batch
          ? current.state.revisionRequests.find(
              (entry) => entry.id === scoped.handoff.context.action.requestId,
            )
          : null;
        if (
          (!batch && current.stateId !== scoped.handoff.stateId) ||
          (batch &&
            (!request ||
              request.status !== "submitted" ||
              request.attemptId !== scoped.handoff.context.action.attemptId ||
              current.revision !== request.base))
        ) {
          discardHandoff(scoped.id);
          if (batch && request?.status === "submitted") {
            try {
              engine.updateRevisionRequest(request.id, {
                status: "conflicted",
                attemptId: request.attemptId,
                error: "stale_base",
              });
            } catch {
              // A concurrent result or retry already owns this request.
            }
          }
          return json(409, {
            error: batch
              ? "Revision request attempt is no longer active"
              : "Agent handoff context changed; ask the agent again",
          });
        }
      }
      const scopedRevisionRead = scoped
        ? new RegExp(
            `^${documentBase}/(?:preview|annotations)/([a-f0-9-]{36})$`,
          ).exec(path)
        : null;
      if (scopedRevisionRead) {
        const proposal = engine
          .snapshot()
          .state.proposals.find((entry) => entry.id === scopedRevisionRead[1]);
        if (
          !proposal ||
          !scoped.handoff.allowedRevisions.includes(proposal.revision)
        )
          return json(403, {
            error: "Agent handoff does not allow this revision",
          });
      }
      if (
        scoped &&
        !(
          (req.method === "GET" &&
            (path === "/api/state" ||
              new RegExp(
                `^${documentBase}/revisions/sha256:[a-f0-9]{64}/files$`,
              ).test(path) ||
              new RegExp(`^${documentBase}/preview/[a-f0-9-]{36}$`).test(
                path,
              ) ||
              new RegExp(`^${documentBase}/annotations/[a-f0-9-]{36}$`).test(
                path,
              ) ||
              path === `/api/handoffs/${scoped.id}`)) ||
          (req.method === "POST" &&
            (path === `${documentBase}/review-context` ||
              (path === `${documentBase}/proposals` &&
                ["address-comment", "revision-request"].includes(
                  scoped.handoff.context.action.kind,
                )) ||
              (path === `/api/handoffs/${scoped.id}/draft` &&
                scoped.handoff.context.action.kind !== "address-comment") ||
              (path === `/api/handoffs/${scoped.id}/reply-draft` &&
                scoped.handoff.context.action.kind === "address-comment")))
        )
      )
        return json(403, { error: "Agent handoff does not allow this route" });
      const needed = routeCapability(req.method, path);
      if (needed) requireCapability(principal, needed);
      if (
        await documentRoute({
          engine,
          documentId,
          req,
          json,
          path,
          origin,
          principal,
          scope: scoped?.handoff,
        })
      )
        return;
      if (req.method === "GET" && path === "/api/state") {
        const s = engine.snapshot();
        return json(200, {
          session: publicPrincipal(principal),
          ...(principal.kind === "session" &&
          principal.role === "owner" &&
          config.workspaceManagementUrl
            ? { workspaceManagementUrl: config.workspaceManagementUrl }
            : {}),
          state: {
            ...s.state,
            revisionRequests: s.state.revisionRequests.map(
              publicRevisionRequest,
            ),
          },
          agentInvocationAvailable: Boolean(agentInvocation),
          stateId: s.stateId,
          revision: s.revision,
          title: s.index?.title ?? "New document",
          resolutions: Object.fromEntries(
            s.state.comments.map((c) => [
              c.id,
              s.index
                ? resolveTarget(s.index, c.target)
                : { status: "orphaned" },
            ]),
          ),
        });
      }
      const handoff = /^\/api\/handoffs\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === "GET" && handoff) {
        const record = getHandoff(handoff[1]);
        const ownsRecord =
          record &&
          (scoped?.id === handoff[1] ||
            (principal.kind === "session" &&
              JSON.stringify(record.creator) ===
                JSON.stringify(principal.identity)));
        return record
          ? ownsRecord
            ? json(200, publicHandoff(record))
            : json(403, { error: "Agent handoff resource mismatch" })
          : json(404, { error: "Agent handoff expired or was not found" });
      }
      const diff = new RegExp(`^${documentBase}/diff/([a-f0-9-]{36})$`).exec(
        path,
      );
      if (req.method === "GET" && diff) {
        const after = engine.snapshot(diff[1]);
        const proposal = after.state.proposals.find((p) => p.id === diff[1]);
        const file = url.searchParams.get("file");
        if (!proposal?.diff.files.some((entry) => entry.path === file))
          return json(404, {
            error: "Choose a changed file from this version.",
          });
        const before = proposal.parent
          ? engine.snapshot(proposal.parent)
          : null;
        return json(200, fileDiff(before, after, proposal, file));
      }
      const annotations = new RegExp(
        `^${documentBase}/annotations/([a-f0-9-]{36})$`,
      ).exec(path);
      if (req.method === "GET" && annotations) {
        const s = engine.snapshot(annotations[1]);
        return json(200, {
          revision: s.revision,
          stateId: s.stateId,
          anchors: Object.fromEntries(
            s.state.comments.map((c) => [
              c.id,
              s.index
                ? resolveTarget(s.index, c.target)
                : { status: "orphaned" },
            ]),
          ),
          labels: Object.fromEntries(
            s.state.comments.map((c) => [
              c.target.element,
              s.index?.elements[c.target.element]?.text.trim().slice(0, 100) ||
                c.target.element,
            ]),
          ),
        });
      }
      const preview = new RegExp(
        `^${documentBase}/preview/([a-f0-9-]{36})$`,
      ).exec(path);
      if (req.method === "GET" && preview) {
        const s = engine.snapshot(preview[1]),
          capability = secret();
        capabilities.set(capability, s);
        return json(200, {
          url: `${config.basePath}/frame/${capability}/document.html`,
          capability,
          revision: s.revision,
        });
      }
      if (req.method !== "POST") return json(404, { error: "Unknown route" });
      if (
        req.headers.origin !== origin ||
        req.headers["content-type"] !== "application/json"
      )
        return json(403, { error: "Invalid review origin or content type" });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) return json(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (path === `${documentBase}/comments`) {
        exactBody(body, ["target", "body"]);
        return json(
          201,
          engine.comment({
            target: body.target,
            body: body.body,
            author: principal.identity,
          }),
        );
      }
      if (path === "/api/handoffs") {
        exactBody(body, ["id", "accessToken", "context"]);
        if (!handoffId(body.id) || !handoffToken(body.accessToken))
          throw new Error("Invalid agent handoff credential");
        if (
          Object.values(config.credentials).some(
            (credential) => credential.token === body.accessToken,
          ) ||
          [...handoffs.values()].some(
            (handoff) => handoff.accessToken === body.accessToken,
          )
        )
          throw new Error("Agent handoff credential must be unique");
        const existing = getHandoff(body.id);
        if (existing) throw new Error("Agent handoff already exists");
        try {
          let validated = validateHandoffContext(body.context);
          if (validated.context.action.kind === "revision-request") {
            requireCapability(principal, CAPABILITIES.REQUEST);
            const existingRequest = engine
              .snapshot()
              .state.revisionRequests.find(
                (entry) => entry.id === validated.context.action.requestId,
              );
            if (
              existingRequest?.attemptId !== undefined &&
              existingRequest.attemptId !==
                validated.context.action.attemptId &&
              ["submitted", "running"].includes(existingRequest.status)
            )
              throw Object.assign(
                new Error("A revision request attempt is already active"),
                { status: 409, code: "attempt_conflict" },
              );
            const request = engine.updateRevisionRequest(
              validated.context.action.requestId,
              {
                status: "submitted",
                attemptId: validated.context.action.attemptId,
              },
            );
            const refreshed = engine.snapshot();
            validated = {
              ...validated,
              stateId: refreshed.stateId,
              headRevision: request.base,
            };
          }
          const action = validated.context.action,
            record = {
              ...validated,
              draft: null,
              replyDraft: null,
              expiresAt: Date.now() + HANDOFF_TTL,
              accessToken: body.accessToken,
              creator: principal.identity,
              principal: handoffPrincipal(
                principal,
                action.kind === "address-comment"
                  ? [
                      CAPABILITIES.READ,
                      CAPABILITIES.REPLY,
                      CAPABILITIES.PROPOSE,
                    ]
                  : action.kind === "revision-request"
                    ? [CAPABILITIES.READ, CAPABILITIES.PROPOSE]
                    : [
                        CAPABILITIES.READ,
                        CAPABILITIES.COMMENT,
                        CAPABILITIES.HANDOFF,
                      ],
              ),
            };
          handoffs.set(body.id, record);
          record.expirationTimer = globalThis.setTimeout(() => {
            discardHandoff(body.id, true);
          }, HANDOFF_TTL);
          record.expirationTimer.unref?.();
          return json(201, publicHandoff(record));
        } catch (error) {
          const { status, ...result } = safeRouteError(error);
          return json(status, result);
        }
      }
      const handoffDraft = /^\/api\/handoffs\/([a-f0-9-]{36})\/draft$/.exec(
        path,
      );
      if (handoffDraft) {
        exactBody(body, ["kind", "content"]);
        const record = getHandoff(handoffDraft[1]);
        if (!record)
          return json(404, { error: "Agent handoff expired or was not found" });
        if (scoped?.id !== handoffDraft[1])
          return json(403, { error: "Agent handoff resource mismatch" });
        if (
          body.kind !== record.context.action.kind ||
          typeof body.content !== "string" ||
          body.content.length > 20000 ||
          (body.kind === "comment" && !body.content.trim())
        )
          throw new Error("Invalid agent handoff draft");
        record.draft = {
          id: secret(),
          kind: body.kind,
          content: body.content,
        };
        return json(200, { draft: record.draft });
      }
      const replyDraft = /^\/api\/handoffs\/([a-f0-9-]{36})\/reply-draft$/.exec(
        path,
      );
      if (replyDraft) {
        exactBody(body, ["commentId", "body"]);
        const record = getHandoff(replyDraft[1]),
          commentId = record?.context.action.commentId;
        if (!record)
          return json(404, { error: "Agent handoff expired or was not found" });
        if (scoped?.id !== replyDraft[1])
          return json(403, { error: "Agent handoff resource mismatch" });
        if (
          record.context.action.kind !== "address-comment" ||
          body.commentId !== commentId ||
          typeof body.body !== "string" ||
          !body.body.trim() ||
          body.body.length > 20000
        )
          throw new Error("Invalid focused comment reply draft");
        record.replyDraft = {
          id: secret(),
          commentId,
          body: body.body,
        };
        return json(200, { replyDraft: record.replyDraft });
      }
      const revoke = /^\/api\/handoffs\/([a-f0-9-]{36})\/revoke$/.exec(path);
      if (revoke) {
        exactBody(body, []);
        const record = getHandoff(revoke[1]);
        if (!record)
          return json(404, { error: "Agent handoff expired or was not found" });
        if (
          principal.kind !== "session" ||
          JSON.stringify(record.creator) !== JSON.stringify(principal.identity)
        )
          return json(403, { error: "Only the handoff creator can revoke it" });
        discardHandoff(revoke[1], true);
        return json(200, { revoked: true });
      }
      const invocation = new RegExp(
        `^${documentBase}/revision-requests/([a-f0-9-]{36})/invoke$`,
      ).exec(path);
      if (invocation) {
        exactBody(body, ["attemptId"]);
        if (!uuid(body.attemptId)) throw new Error("Invalid attempt ID");
        try {
          const result = startHostInvocation(invocation[1], body.attemptId);
          return json(result.status, result.body);
        } catch (error) {
          const { status, ...result } = safeRouteError(error);
          return json(status, result);
        }
      }
      const comment = new RegExp(
        `^${documentBase}/comments/([a-f0-9-]{36})/(replies|resolve)$`,
      ).exec(path);
      if (comment) {
        const reply = comment[2] === "replies";
        exactBody(body, reply ? ["body", "stateId", "key"] : ["stateId"]);
        if (!reply)
          return json(
            200,
            review.resolveComment(comment[1], body.stateId, principal.identity),
          );
        try {
          return json(200, {
            comment: publicComment(
              engine.reply(
                comment[1],
                body.body,
                principal.identity,
                body.key,
                body.stateId,
              ),
            ),
          });
        } catch (error) {
          const { status, ...result } = documentErrorResult(error);
          return json(status, result);
        }
      }
      const decision = new RegExp(
        `^${documentBase}/proposals/([a-f0-9-]{36})/(accept|reject)$`,
      ).exec(path);
      if (decision) {
        exactBody(body, ["revision", "stateId"]);
        return json(
          200,
          review.decide(
            decision[1],
            decision[2],
            body.revision,
            body.stateId,
            principal.identity,
          ),
        );
      }
      return json(404, { error: "Unknown route" });
    } catch (error) {
      return json(error?.status ?? 409, {
        ...(error?.code ? { code: error.code } : {}),
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  });
  server.once("close", () => {
    capabilities.clear();
    for (const id of handoffs.keys()) discardHandoff(id);
    for (const invocation of activeInvocations.values())
      invocation.interrupted = true;
    for (const invocation of activeInvocations.values())
      invocation.controller.abort();
    activeInvocations.clear();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  origin = viewerOrigin(config, server.address().port);
  const baseUrl = `${origin}${config.basePath}`,
    healthUrl = `${baseUrl}/healthz`,
    ownerUrl = `${baseUrl}/#${config.ownerToken}`,
    reviewerUrl = config.reviewerToken
      ? `${baseUrl}/#${config.reviewerToken}`
      : undefined;
  return {
    server,
    origin,
    baseUrl,
    healthUrl,
    documentId,
    ownerUrl,
    ...(reviewerUrl ? { reviewerUrl } : {}),
  };
}
