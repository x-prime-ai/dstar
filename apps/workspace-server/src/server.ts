import {
  DocumentIndex,
  resolveCanonicalTarget,
  nodeTextStream,
  type AnnotationInput,
  type DstarActor,
  type DstarAnnotation,
  type DstarDocument,
  type DstarTarget,
} from "@dstar/core";
import {
  PackageCommands,
  PackageRepository,
  PackageSnapshot,
} from "@dstar/node";
import {
  publishProjections,
  renderCanonicalHtml,
  safeAssetResponse,
  sanitizeStoredProjectionHtml,
  validateStoredTextProjection,
} from "@dstar/render-html";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, resolve } from "node:path";

const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 1024 * 1024;
const MUTATIONS_PER_MINUTE = 60;

export interface WorkspaceServerOptions {
  readonly packageRoot: string;
  readonly runtimeRoot: string;
  readonly human: DstarActor;
  readonly host?: "127.0.0.1" | "::1";
  readonly port?: number;
  readonly webRoot?: string;
  readonly now?: () => string;
  readonly id?: (prefix: string) => string;
}

export interface WorkspaceServerHandle {
  readonly origin: string;
  readonly launchUrl: string;
  readonly token: string;
  readonly csrfToken: string;
  close(): Promise<void>;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Request body must be a JSON object");
  return value as JsonObject;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new HttpError(400, `${name} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  if (
    !request.headers["content-type"]
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Mutations require application/json");
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > MAX_BODY_BYTES)
    throw new HttpError(413, "Request body exceeds the configured limit");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_BODY_BYTES)
      throw new HttpError(413, "Request body exceeds the configured limit");
    chunks.push(bytes);
  }
  try {
    return jsonObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  origin?: string,
): void {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": bytes.byteLength,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...(origin
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {}),
  });
  response.end(bytes);
}

function routeId(
  pathname: string,
  prefix: string,
  suffix = "",
): string | undefined {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix))
    return undefined;
  const value = pathname.slice(
    prefix.length,
    suffix ? -suffix.length : undefined,
  );
  return value && !value.includes("/") ? decodeURIComponent(value) : undefined;
}

function humanActor(
  actor: DstarActor,
): asserts actor is DstarActor & { type: "human" } {
  if (actor.type !== "human")
    throw new Error("Workspace human actor must have type human");
}

function snapshotWithDocument(
  snapshot: PackageSnapshot,
  document: DstarDocument,
  revision: string,
  headChange: string,
): PackageSnapshot {
  return new PackageSnapshot({
    root: snapshot.root,
    snapshotId: snapshot.snapshotId,
    inventory: snapshot.inventory,
    pkg: {
      manifest: { ...snapshot.manifest, revision, headChange },
      document,
      annotations: snapshot.annotations,
      delegations: snapshot.delegations,
      changes: snapshot.changes,
      ...(snapshot.sources ? { sources: snapshot.sources } : {}),
      ...(snapshot.projections ? { projections: snapshot.projections } : {}),
    },
    bytes: new Map(
      snapshot.inventory.flatMap((entry) => {
        const bytes = snapshot.readFile(entry.path);
        return bytes ? [[entry.path, bytes] as const] : [];
      }),
    ),
    diagnostics: snapshot.diagnostics,
  });
}

class WorkspaceSession {
  readonly repository: PackageRepository;
  readonly commands: PackageCommands;
  readonly packageRoot: string;
  readonly human: DstarActor & { type: "human" };
  readonly token = randomBytes(32).toString("base64url");
  readonly csrfToken = randomBytes(32).toString("base64url");
  readonly now: () => string;
  readonly id: (prefix: string) => string;
  snapshot!: PackageSnapshot;
  readonly events = new Set<ServerResponse>();
  readonly mutationTimes: number[] = [];

  constructor(options: WorkspaceServerOptions) {
    humanActor(options.human);
    this.packageRoot = resolve(options.packageRoot);
    this.repository = new PackageRepository(resolve(options.runtimeRoot));
    this.commands = new PackageCommands(this.repository);
    this.human = options.human;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id =
      options.id ??
      ((prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`);
  }

  async open(): Promise<void> {
    this.snapshot = await this.repository.open(this.packageRoot);
  }

  async refresh(): Promise<void> {
    const next = await this.repository.open(this.packageRoot);
    if (this.snapshot && next.snapshotId === this.snapshot.snapshotId) return;
    this.snapshot = next;
    const event = `event: snapshot\ndata: ${JSON.stringify({ snapshotId: next.snapshotId })}\n\n`;
    for (const response of this.events) response.write(event);
  }

  mutationAllowed(): boolean {
    const threshold = Date.now() - 60_000;
    while ((this.mutationTimes[0] ?? Infinity) < threshold)
      this.mutationTimes.shift();
    if (this.mutationTimes.length >= MUTATIONS_PER_MINUTE) return false;
    this.mutationTimes.push(Date.now());
    return true;
  }

  identity(body: JsonObject) {
    return {
      expectedSnapshotId: requiredString(
        body.expectedSnapshotId,
        "expectedSnapshotId",
      ),
      idempotencyKey: requiredString(body.idempotencyKey, "idempotencyKey"),
    };
  }

  resolutions() {
    return this.snapshot.annotations.map((annotation) => {
      if (annotation.target.source === "document") {
        return {
          annotation,
          resolution: resolveCanonicalTarget(this.snapshot.document, {
            ...annotation.target,
            revision: this.snapshot.manifest.revision,
          }),
        };
      }
      const projection = this.snapshot.projections?.projections.find(
        (candidate) => candidate.id === annotation.target.source,
      );
      if (!projection)
        return { annotation, resolution: { state: "missing-source" as const } };
      if (projection.generatedFromRevision !== this.snapshot.manifest.revision)
        return {
          annotation,
          resolution: { state: "projection-stale" as const },
        };
      const selector = annotation.target.selector;
      const segmentIds = new Set(
        (projection.segments ?? []).map((segment) => segment.id),
      );
      const exact =
        selector.type === "SegmentSelector"
          ? segmentIds.has(selector.segment)
          : selector.type === "SegmentRangeSelector"
            ? segmentIds.has(selector.start.segment) &&
              segmentIds.has(selector.end.segment)
            : false;
      return {
        annotation,
        resolution: {
          state: exact ? ("exact" as const) : ("orphaned" as const),
        },
      };
    });
  }
}

function authenticate(
  request: IncomingMessage,
  session: WorkspaceSession,
  origin: string,
  mutation: boolean,
): void {
  if (request.headers.cookie)
    throw new HttpError(401, "Cookies are not accepted for API authentication");
  const requestOrigin = request.headers.origin;
  if (requestOrigin && requestOrigin !== origin)
    throw new HttpError(403, "Request origin is not allowed");
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new HttpError(403, "Cross-site requests are not allowed");
  const authorization = request.headers.authorization;
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  if (!sameSecret(bearer, session.token))
    throw new HttpError(401, "Session authentication failed");
  if (mutation) {
    const csrf = request.headers["x-dstar-csrf"];
    if (typeof csrf !== "string" || !sameSecret(csrf, session.csrfToken))
      throw new HttpError(403, "CSRF validation failed");
    if (!session.mutationAllowed())
      throw new HttpError(429, "Mutation rate limit exceeded");
  }
}

function endpointProjectionTarget(body: JsonObject): {
  target: DstarTarget;
  canonicalTargets?: DstarAnnotation["canonicalTargets"];
} {
  const target = jsonObject(body.target) as unknown as DstarTarget;
  return {
    target,
    ...(Array.isArray(body.canonicalTargets)
      ? {
          canonicalTargets: body.canonicalTargets as NonNullable<
            DstarAnnotation["canonicalTargets"]
          >,
        }
      : {}),
  };
}

async function handleRead(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  session: WorkspaceSession,
  origin: string,
): Promise<boolean> {
  const pathname = url.pathname;
  if (pathname === `${API_PREFIX}/session`) {
    writeJson(
      response,
      200,
      { csrfToken: session.csrfToken, human: session.human },
      origin,
    );
    return true;
  }
  if (pathname === `${API_PREFIX}/snapshot`) {
    writeJson(
      response,
      200,
      {
        snapshotId: session.snapshot.snapshotId,
        manifest: session.snapshot.manifest,
        diagnostics: session.snapshot.diagnostics,
        capabilities: {
          canonicalEditing: false,
          comment: true,
          delegate: true,
          humanDecision: true,
          embeddedModelRuntime: false,
        },
        projections: (session.snapshot.projections?.projections ?? []).map(
          (projection) => ({
            ...projection,
            fresh:
              projection.generatedFromRevision ===
              session.snapshot.manifest.revision,
          }),
        ),
      },
      origin,
    );
    return true;
  }
  if (pathname === `${API_PREFIX}/document`) {
    const view = renderCanonicalHtml(session.snapshot);
    writeJson(
      response,
      200,
      {
        documentRevision: view.documentRevision,
        html: view.html,
        nodeOrder: view.nodeOrder,
        textRuns: view.textRuns.map(({ inline, ...run }) => ({
          ...run,
          text: typeof inline.text === "string" ? inline.text : "",
        })),
        nodeTexts: Object.fromEntries(
          Array.from(
            new DocumentIndex(session.snapshot.document).nodes.entries(),
            ([id, node]) => [id, nodeTextStream(node)],
          ),
        ),
        diagnostics: view.diagnostics,
      },
      origin,
    );
    return true;
  }
  if (pathname === `${API_PREFIX}/annotations`) {
    writeJson(response, 200, session.resolutions(), origin);
    return true;
  }
  if (pathname === `${API_PREFIX}/delegations`) {
    writeJson(response, 200, session.snapshot.delegations, origin);
    return true;
  }
  if (pathname === `${API_PREFIX}/changes`) {
    writeJson(response, 200, session.snapshot.changes, origin);
    return true;
  }
  if (pathname === `${API_PREFIX}/versions`) {
    writeJson(
      response,
      200,
      session.commands.history(session.snapshot),
      origin,
    );
    return true;
  }
  if (pathname === `${API_PREFIX}/sources`) {
    writeJson(
      response,
      200,
      session.snapshot.sources ?? { sources: [] },
      origin,
    );
    return true;
  }
  const historicalId = routeId(
    pathname,
    `${API_PREFIX}/versions/`,
    "/document",
  );
  if (historicalId) {
    const materialized = session.commands.showVersion(
      session.snapshot,
      historicalId,
    );
    if (!materialized.valid || !materialized.document)
      throw new HttpError(422, "Historical canonical materialization failed");
    writeJson(
      response,
      200,
      {
        changeId: historicalId,
        revision: materialized.revision,
        historical: true,
        html: renderCanonicalHtml(
          snapshotWithDocument(
            session.snapshot,
            materialized.document,
            materialized.revision!,
            historicalId,
          ),
        ).html,
        diagnostics: materialized.diagnostics,
      },
      origin,
    );
    return true;
  }
  const projectionId = routeId(pathname, `${API_PREFIX}/projections/`);
  if (projectionId) {
    const projection = session.snapshot.projections?.projections.find(
      (candidate) => candidate.id === projectionId,
    );
    if (!projection) throw new HttpError(404, "Projection does not exist");
    const bytes = session.snapshot.readFile(projection.path);
    if (!bytes) throw new HttpError(404, "Projection artifact is unavailable");
    const sanitized =
      projection.mediaType === "text/html"
        ? sanitizeStoredProjectionHtml(bytes, projection)
        : undefined;
    const validatedText =
      projection.mediaType === "text/markdown" ||
      projection.mediaType === "text/plain"
        ? validateStoredTextProjection(bytes, projection)
        : undefined;
    writeJson(
      response,
      200,
      {
        projection: sanitized
          ? { ...projection, reviewable: sanitized.reviewable }
          : validatedText
            ? { ...projection, reviewable: validatedText.reviewable }
            : { ...projection, reviewable: false },
        content:
          sanitized?.html ??
          validatedText?.text ??
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        fresh:
          projection.generatedFromRevision ===
          session.snapshot.manifest.revision,
        diagnostics: sanitized?.diagnostics ?? validatedText?.diagnostics ?? [],
      },
      origin,
    );
    return true;
  }
  const changeId = routeId(pathname, `${API_PREFIX}/changes/`, "/simulation");
  if (changeId) {
    const simulation = session.commands.simulateChange(
      session.snapshot,
      changeId,
    );
    const beforeHtml = renderCanonicalHtml(session.snapshot).html;
    const afterHtml =
      simulation.result && simulation.resultRevision
        ? renderCanonicalHtml(
            snapshotWithDocument(
              session.snapshot,
              simulation.result,
              simulation.resultRevision,
              changeId,
            ),
          ).html
        : undefined;
    writeJson(
      response,
      200,
      { ...simulation, beforeHtml, ...(afterHtml ? { afterHtml } : {}) },
      origin,
    );
    return true;
  }
  const assetPath = routeId(pathname, `${API_PREFIX}/assets/`);
  if (assetPath) {
    const decodedPath = Buffer.from(assetPath, "base64url").toString("utf8");
    const asset = safeAssetResponse(session.snapshot, decodedPath);
    response.writeHead(asset.status, asset.headers);
    response.end(asset.bytes);
    return true;
  }
  if (pathname === `${API_PREFIX}/events`) {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    response.write(
      `event: snapshot\ndata: ${JSON.stringify({ snapshotId: session.snapshot.snapshotId })}\n\n`,
    );
    session.events.add(response);
    request.once("close", () => session.events.delete(response));
    return true;
  }
  return false;
}

async function handleMutation(
  response: ServerResponse,
  url: URL,
  session: WorkspaceSession,
  origin: string,
  body: JsonObject,
): Promise<boolean> {
  const pathname = url.pathname;
  const identity = session.identity(body);
  let next: PackageSnapshot | undefined;
  if (pathname === `${API_PREFIX}/annotations`) {
    const purpose = requiredString(
      body.purpose,
      "purpose",
    ) as AnnotationInput["purpose"];
    const scope = requiredString(
      body.scope,
      "scope",
    ) as AnnotationInput["scope"];
    const target = endpointProjectionTarget(body);
    const audience = Array.isArray(body.audience)
      ? (body.audience as unknown as AnnotationInput["audience"])
      : undefined;
    next = await session.commands.createAnnotation(
      session.snapshot,
      {
        id: session.id("annotation"),
        purpose,
        scope,
        ...target,
        body: requiredString(body.body, "body"),
        author: session.human,
        createdAt: session.now(),
        ...(audience ? { audience } : {}),
      },
      identity,
    );
  }
  const replyAnnotationId = routeId(
    pathname,
    `${API_PREFIX}/annotations/`,
    "/replies",
  );
  if (replyAnnotationId) {
    next = await session.commands.addHumanReply(
      session.snapshot,
      {
        annotationId: replyAnnotationId,
        reply: {
          id: session.id("reply"),
          body: requiredString(body.body, "body"),
          author: session.human,
          createdAt: session.now(),
        },
      },
      identity,
    );
  }
  const resolveAnnotationId = routeId(
    pathname,
    `${API_PREFIX}/annotations/`,
    "/resolve",
  );
  if (resolveAnnotationId) {
    next = await session.commands.resolveAnnotation(
      session.snapshot,
      resolveAnnotationId,
      session.human,
      session.now(),
      identity,
    );
  }
  if (pathname === `${API_PREFIX}/delegations`) {
    const assigneeName = optionalString(body.assigneeName, "assigneeName");
    const instruction = optionalString(body.instruction, "instruction");
    next = await session.commands.createDelegation(
      session.snapshot,
      {
        id: session.id("delegation"),
        annotationId: requiredString(body.annotationId, "annotationId"),
        assignee: {
          type: "agent",
          id: requiredString(body.assigneeId, "assigneeId"),
          ...(assigneeName ? { name: assigneeName } : {}),
        },
        createdBy: session.human,
        createdAt: session.now(),
        ...(instruction ? { instruction } : {}),
      },
      identity,
    );
  }
  const cancelDelegationId = routeId(
    pathname,
    `${API_PREFIX}/delegations/`,
    "/cancel",
  );
  if (cancelDelegationId) {
    next = await session.commands.cancelDelegation(
      session.snapshot,
      cancelDelegationId,
      session.human,
      session.now(),
      optionalString(body.reason, "reason"),
      identity,
    );
  }
  for (const decision of ["accept", "reject", "supersede"] as const) {
    const decisionChangeId = routeId(
      pathname,
      `${API_PREFIX}/changes/`,
      `/${decision}`,
    );
    if (!decisionChangeId) continue;
    if (decision === "accept") {
      next = await session.commands.acceptChange(
        session.snapshot,
        decisionChangeId,
        session.human,
        session.now(),
        requiredString(body.expectedResultRevision, "expectedResultRevision"),
        identity,
      );
    } else if (decision === "reject") {
      next = await session.commands.rejectChange(
        session.snapshot,
        decisionChangeId,
        session.human,
        session.now(),
        optionalString(body.reason, "reason"),
        identity,
      );
    } else {
      next = await session.commands.supersedeChange(
        session.snapshot,
        decisionChangeId,
        session.human,
        session.now(),
        optionalString(body.reason, "reason"),
        identity,
      );
    }
  }
  const rebaseChangeId = routeId(
    pathname,
    `${API_PREFIX}/changes/`,
    "/request-rebase",
  );
  if (rebaseChangeId) {
    const change = session.snapshot.changes.find(
      (candidate) => candidate.id === rebaseChangeId,
    );
    const annotationId = change?.motivatedBy?.[0];
    if (!change || !annotationId)
      throw new HttpError(
        422,
        "A rebase request requires a proposal linked to an annotation",
      );
    next = await session.commands.createDelegation(
      session.snapshot,
      {
        id: session.id("delegation"),
        annotationId,
        assignee: {
          type: "agent",
          id: requiredString(body.assigneeId, "assigneeId"),
        },
        createdBy: session.human,
        createdAt: session.now(),
        instruction:
          optionalString(body.instruction, "instruction") ??
          `Rebase proposal ${rebaseChangeId} onto the current canonical head.`,
      },
      identity,
    );
  }
  const regenerateId = routeId(
    pathname,
    `${API_PREFIX}/projections/`,
    "/regenerate",
  );
  if (regenerateId) {
    const result = await publishProjections(
      session.repository,
      session.snapshot,
      {
        projectionId: regenerateId,
        createdAt: session.now(),
      },
    );
    next = result.snapshot;
  }
  if (!next) return false;
  session.snapshot = next;
  const event = `event: snapshot\ndata: ${JSON.stringify({ snapshotId: next.snapshotId })}\n\n`;
  for (const eventResponse of session.events) eventResponse.write(event);
  writeJson(response, 200, { snapshotId: next.snapshotId }, origin);
  return true;
}

async function serveStatic(
  response: ServerResponse,
  url: URL,
  webRoot: string | undefined,
): Promise<void> {
  if (!webRoot) throw new HttpError(404, "Review application is not built");
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!requested || requested.includes("..") || requested.includes("\\"))
    throw new HttpError(404, "Static asset does not exist");
  let path = join(webRoot, requested);
  try {
    if (!(await stat(path)).isFile()) path = join(webRoot, "index.html");
  } catch {
    path = join(webRoot, "index.html");
  }
  const type =
    extname(path) === ".js"
      ? "text/javascript; charset=utf-8"
      : extname(path) === ".css"
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8";
  const metadata = await stat(path);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": metadata.size,
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(path).pipe(response);
}

export async function startWorkspaceServer(
  options: WorkspaceServerOptions,
): Promise<WorkspaceServerHandle> {
  const session = new WorkspaceSession(options);
  await session.open();
  let serverOrigin = "";
  const webRoot = options.webRoot ? resolve(options.webRoot) : undefined;
  const server: Server = createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url ?? "/",
        serverOrigin || "http://127.0.0.1",
      );
      const isApi = url.pathname.startsWith(API_PREFIX);
      if (!isApi) {
        if (request.method !== "GET" && request.method !== "HEAD")
          throw new HttpError(405, "Method not allowed");
        await serveStatic(response, url, webRoot);
        return;
      }
      const mutation = request.method === "POST";
      authenticate(request, session, serverOrigin, mutation);
      if (
        request.method === "GET" &&
        (await handleRead(request, response, url, session, serverOrigin))
      )
        return;
      if (mutation) {
        const body = await readJsonBody(request);
        if (await handleMutation(response, url, session, serverOrigin, body))
          return;
      }
      throw new HttpError(404, "API route does not exist");
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 422;
      writeJson(response, status, {
        error:
          error instanceof Error ? error.message : "Workspace request failed",
        ...(error && typeof error === "object" && "diagnostics" in error
          ? { diagnostics: (error as { diagnostics: unknown }).diagnostics }
          : {}),
      });
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () =>
      accept(),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Workspace server did not bind TCP");
  const host = options.host ?? "127.0.0.1";
  serverOrigin = `http://${host === "::1" ? `[${host}]` : host}:${address.port}`;

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(session.packageRoot, { recursive: true }, () => {
      setTimeout(() => void session.refresh().catch(() => undefined), 25);
    });
  } catch {
    watcher = undefined;
  }
  return Object.freeze({
    origin: serverOrigin,
    launchUrl: `${serverOrigin}/#token=${encodeURIComponent(session.token)}`,
    token: session.token,
    csrfToken: session.csrfToken,
    close: async () => {
      watcher?.close();
      for (const response of session.events) response.end();
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  });
}
