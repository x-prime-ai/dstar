import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { clearInterval, setInterval } from "node:timers";
import { startViewer } from "@dstar/viewer";

import { WORKSPACE_ID, workspaceStore } from "./store.mjs";

const JSON_LIMIT = 16 * 1024;
const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

class WorkspaceHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(message) {
  throw new Error(message);
}

function canonicalOrigin(value, required = false) {
  if (value === undefined && !required) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("externalOrigin must be a canonical HTTPS origin");
  }
  if (value !== url.origin || url.protocol !== "https:")
    fail("externalOrigin must be a canonical HTTPS origin without a path");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !isIP(hostname) &&
    (hostname.length > 253 ||
      !hostname
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
  )
    fail("externalOrigin must use a literal IP or lowercase DNS hostname");
  return value;
}

function validToken(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{48,256}$/.test(value))
    fail(`${name} must contain 48-256 base64url characters`);
  return value;
}

function sameToken(actual, expected) {
  if (typeof actual !== "string") return false;
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function authority(request, expectedHost) {
  const critical = new Set(["host", "origin", "authorization", "content-type"]);
  const seen = new Set();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (name === "forwarded" || name.startsWith("x-forwarded-")) return false;
    if (critical.has(name) && seen.has(name)) return false;
    seen.add(name);
  }
  return request.headers.host === expectedHost;
}

function safeTarget(request, origin) {
  const target = request.url;
  if (
    !target?.startsWith("/") ||
    target.startsWith("//") ||
    /[\\#\s]/.test(target)
  )
    return null;
  try {
    for (const segment of target.split("?")[0].split("/")) {
      const decoded = decodeURIComponent(segment);
      if (
        decoded === "." ||
        decoded === ".." ||
        /[/\\]/.test(decoded) ||
        [...decoded].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      )
        return null;
    }
    const url = new URL(target, origin);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

async function body(request) {
  if (request.headers["content-type"] !== "application/json")
    throw new WorkspaceHttpError(
      415,
      "invalid_content_type",
      "Use application/json",
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT)
      throw new WorkspaceHttpError(
        413,
        "request_too_large",
        "Request is too large",
      );
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new WorkspaceHttpError(
      400,
      "invalid_json",
      "Request body is not valid JSON",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorkspaceHttpError(
      400,
      "invalid_json",
      "Request body must be an object",
    );
  return value;
}

function closeServer(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function bearer(request) {
  const value = request.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ")
    ? value.slice(7)
    : "";
}

export async function startWorkspaceService(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    fail("Workspace service options are required");
  const host = options.host ?? "127.0.0.1";
  if (typeof host !== "string" || !isIP(host))
    fail("host must be an IP address");
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    fail("port must be an integer from 0 through 65535");
  const externalOrigin = canonicalOrigin(options.externalOrigin);
  if (!externalOrigin && host !== "127.0.0.1" && host !== "::1")
    fail("Non-loopback workspace service requires externalOrigin");
  let workspaceDomain;
  if (externalOrigin) {
    if (
      typeof options.workspaceDomain !== "string" ||
      !options.workspaceDomain
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      fail("workspaceDomain must be a lowercase DNS name without a wildcard");
    workspaceDomain = options.workspaceDomain;
  } else if (options.workspaceDomain !== undefined) {
    fail("workspaceDomain is only valid with externalOrigin");
  }
  const creationToken = options.creationToken;
  if (externalOrigin) validToken(creationToken, "creationToken");
  else if (creationToken !== undefined)
    validToken(creationToken, "creationToken");
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
  if (!Number.isSafeInteger(cleanupIntervalMs) || cleanupIntervalMs < 1_000)
    fail("cleanupIntervalMs must be at least 1000");
  const store = workspaceStore({
    root: options.root,
    seedRoot: options.seedRoot,
    maxWorkspaces: options.maxWorkspaces,
    maxWorkspaceBytes: options.maxWorkspaceBytes,
    maxTotalBytes: options.maxTotalBytes,
    ttlMs: options.ttlMs,
    lockTimeoutMs: options.lockTimeoutMs,
    now: options.now,
    randomId: options.randomId,
    randomToken: options.randomToken,
    createSessionConfig: options.sessionAdapter?.create,
  });
  const releaseServiceLease = store.acquireServiceLease();
  try {
    store.recover();
  } catch (error) {
    releaseServiceLease();
    throw error;
  }
  const sessionLinks =
    options.sessionAdapter?.links ??
    (({ viewer }) => ({
      ownerUrl: viewer.ownerUrl ?? viewer.url,
      ...(viewer.reviewerUrl ? { reviewerUrl: viewer.reviewerUrl } : {}),
    }));
  const startOptions =
    options.sessionAdapter?.start ?? (({ viewerOptions }) => viewerOptions);
  const runtimes = new Map();
  const starts = new Map();
  const now = options.now ?? (() => Date.now());
  let serviceOrigin;
  let closing = false;

  const workspaceOrigin = (id) =>
    externalOrigin ? `https://${id}.${workspaceDomain}` : undefined;
  const manageUrl = (record, ownerToken) =>
    `${serviceOrigin}/workspaces/${record.id}#${ownerToken}`;
  const publicWorkspace = (record) => ({
    id: record.id,
    generation: record.generation,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  });

  async function startRuntime(loaded) {
    const id = loaded.metadata.id;
    const existing = runtimes.get(id);
    if (
      existing?.generation === loaded.metadata.generation &&
      existing.state === "ready"
    )
      return existing;
    if (starts.has(id)) return starts.get(id);
    const promise = (async () => {
      const origin = workspaceOrigin(id);
      const workspace = publicWorkspace(loaded.metadata);
      const workspaceManagementUrl = manageUrl(
        loaded.metadata,
        loaded.credentials.ownerToken,
      );
      const viewerOptions = startOptions({
        viewerOptions: loaded.credentials.viewerOptions,
        workspace,
        workspaceManagementUrl,
      });
      const viewer = await startViewer(loaded.packageRoot, 0, {
        ...viewerOptions,
        host: "127.0.0.1",
        ...(origin ? { externalOrigin: origin } : {}),
      });
      const runtime = {
        id,
        generation: loaded.metadata.generation,
        state: "ready",
        viewer,
        sessions: sessionLinks({
          viewer,
          viewerOptions,
          workspace,
          workspaceManagementUrl,
        }),
        lastTouch: Date.parse(loaded.metadata.lastAccessAt),
      };
      runtimes.set(id, runtime);
      return runtime;
    })();
    starts.set(id, promise);
    try {
      return await promise;
    } finally {
      starts.delete(id);
    }
  }

  async function getRuntime(id) {
    let loaded;
    try {
      loaded = store.load(id);
    } catch {
      throw new WorkspaceHttpError(
        404,
        "workspace_not_found",
        "Workspace was not found",
      );
    }
    if (Date.parse(loaded.metadata.expiresAt) <= now())
      throw new WorkspaceHttpError(
        404,
        "workspace_not_found",
        "Workspace expired",
      );
    const runtime = runtimes.get(id);
    if (runtime && runtime.state !== "ready")
      throw new WorkspaceHttpError(
        503,
        "workspace_resetting",
        "Workspace is resetting",
      );
    return startRuntime(loaded);
  }

  async function createWorkspace() {
    let created;
    try {
      created = await store.create();
    } catch (error) {
      if (/limit reached/.test(error.message))
        throw new WorkspaceHttpError(429, "workspace_limit", error.message);
      throw error;
    }
    const loaded = store.load(created.metadata.id);
    try {
      const runtime = await startRuntime(loaded);
      return {
        workspace: publicWorkspace(created.metadata),
        manageUrl: manageUrl(created.metadata, created.credentials.ownerToken),
        sessions: runtime.sessions,
      };
    } catch (error) {
      await store.remove(created.metadata.id);
      throw error;
    }
  }

  async function resetWorkspace(id, ownerToken) {
    if (!WORKSPACE_ID.test(id))
      throw new WorkspaceHttpError(
        404,
        "workspace_not_found",
        "Workspace was not found",
      );
    try {
      if (!store.authorize(id, ownerToken))
        throw new WorkspaceHttpError(
          401,
          "owner_required",
          "Workspace owner authorization required",
        );
    } catch (error) {
      if (error instanceof WorkspaceHttpError) throw error;
      throw new WorkspaceHttpError(
        404,
        "workspace_not_found",
        "Workspace was not found",
      );
    }
    const runtime = await getRuntime(id);
    runtime.state = "resetting";
    try {
      await closeServer(runtime.viewer.server);
      runtimes.delete(id);
      const loaded = await store.reset(id, ownerToken);
      const next = await startRuntime(loaded);
      return {
        workspace: publicWorkspace(loaded.metadata),
        manageUrl: manageUrl(loaded.metadata, loaded.credentials.ownerToken),
        sessions: next.sessions,
      };
    } catch (error) {
      runtimes.delete(id);
      throw error;
    }
  }

  async function cleanup() {
    for (const id of store.expired()) {
      if (!store.isExpired(id)) continue;
      const runtime = runtimes.get(id);
      if (runtime) {
        runtime.state = "stopping";
        await closeServer(runtime.viewer.server);
        runtimes.delete(id);
      }
      await store.remove(id, { expiredOnly: true });
    }
  }

  function maybeTouch(runtime, responseStatus, request) {
    const threshold = Math.min(60_000, Math.max(1_000, store.limits.ttlMs / 4));
    if (
      responseStatus >= 400 ||
      !request.headers.authorization ||
      now() - runtime.lastTouch < threshold
    )
      return;
    runtime.lastTouch = now();
    store.touch(runtime.id).catch(() => {});
  }

  function responseJson(response, status, value) {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": bytes.byteLength,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(bytes);
  }

  function shell(response) {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DSTAR workspaces</title><link rel="stylesheet" href="/workspace.css"><main><h1>DSTAR review workspaces</h1><p id="status" role="status">Create an isolated copy of the review seed.</p><button id="create" type="button">Create workspace</button><section id="manage" hidden><dl><dt>Workspace</dt><dd id="workspace-id"></dd><dt>Generation</dt><dd id="generation"></dd><dt>Expires</dt><dd id="expires"></dd></dl><p><a id="open-review">Open review</a></p><button id="reset" type="button">Reset from seed</button></section></main><script type="module" src="/workspace.js"></script></html>`,
    );
  }

  function asset(response, name, type) {
    import("node:fs").then(({ createReadStream }) => {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(publicFile(name)).pipe(response);
    });
  }

  function proxy(request, response, runtime) {
    const address = runtime.viewer.server.address();
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (incoming) => {
        maybeTouch(runtime, incoming.statusCode ?? 502, request);
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent)
        responseJson(response, 503, {
          code: "workspace_unavailable",
          error: "Workspace is temporarily unavailable",
        });
      else response.destroy();
    });
    request.pipe(upstream);
  }

  const server = createServer(async (request, response) => {
    try {
      if (closing)
        throw new WorkspaceHttpError(
          503,
          "service_stopping",
          "Service is stopping",
        );
      const hostHeader = request.headers.host ?? "";
      const controlHost = new URL(serviceOrigin).host;
      if (externalOrigin && hostHeader !== controlHost) {
        const suffix = `.${workspaceDomain}`;
        if (hostHeader.endsWith(suffix)) {
          const id = hostHeader.slice(0, -suffix.length);
          if (!WORKSPACE_ID.test(id) || !authority(request, `${id}${suffix}`))
            throw new WorkspaceHttpError(
              403,
              "invalid_authority",
              "Invalid request authority",
            );
          const runtime = await getRuntime(id);
          if (runtime.state !== "ready")
            throw new WorkspaceHttpError(
              503,
              "workspace_resetting",
              "Workspace is resetting",
            );
          proxy(request, response, runtime);
          return;
        }
      }
      if (!authority(request, controlHost))
        throw new WorkspaceHttpError(
          403,
          "invalid_authority",
          "Invalid request authority",
        );
      const url = safeTarget(request, serviceOrigin);
      if (!url)
        throw new WorkspaceHttpError(
          403,
          "invalid_target",
          "Invalid request target",
        );
      if (
        request.method === "GET" &&
        (url.pathname === "/" ||
          /^\/workspaces\/[a-f0-9]{32}$/.test(url.pathname))
      ) {
        shell(response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace.js") {
        asset(response, "workspace.js", "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace.css") {
        asset(response, "workspace.css", "text/css; charset=utf-8");
        return;
      }
      if (
        (request.method === "POST" &&
          request.headers.origin !== serviceOrigin) ||
        (request.method !== "POST" &&
          request.headers.origin !== undefined &&
          request.headers.origin !== serviceOrigin)
      )
        throw new WorkspaceHttpError(
          403,
          "invalid_origin",
          "Invalid request origin",
        );
      if (request.method === "POST" && url.pathname === "/api/v1/workspaces") {
        if (creationToken && !sameToken(bearer(request), creationToken))
          throw new WorkspaceHttpError(
            401,
            "creation_authorization_required",
            "Creation authorization required",
          );
        const input = await body(request);
        if (Object.keys(input).length)
          throw new WorkspaceHttpError(
            400,
            "invalid_request",
            "Workspace creation does not accept a seed path",
          );
        responseJson(response, 201, await createWorkspace());
        return;
      }
      const item = /^\/api\/v1\/workspaces\/([a-f0-9]{32})$/.exec(url.pathname);
      if (request.method === "GET" && item) {
        let authorized = false;
        try {
          authorized = store.authorize(item[1], bearer(request));
        } catch {
          throw new WorkspaceHttpError(
            404,
            "workspace_not_found",
            "Workspace was not found",
          );
        }
        if (!authorized)
          throw new WorkspaceHttpError(
            401,
            "owner_required",
            "Workspace owner authorization required",
          );
        const runtime = await getRuntime(item[1]);
        await store.touch(item[1]);
        const loaded = store.load(item[1]);
        responseJson(response, 200, {
          workspace: publicWorkspace(loaded.metadata),
          manageUrl: manageUrl(loaded.metadata, loaded.credentials.ownerToken),
          sessions: runtime.sessions,
        });
        return;
      }
      const reset = /^\/api\/v1\/workspaces\/([a-f0-9]{32})\/reset$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && reset) {
        const input = await body(request);
        if (Object.keys(input).length)
          throw new WorkspaceHttpError(
            400,
            "invalid_request",
            "Reset does not accept a seed path",
          );
        responseJson(
          response,
          200,
          await resetWorkspace(reset[1], bearer(request)),
        );
        return;
      }
      throw new WorkspaceHttpError(404, "not_found", "Route was not found");
    } catch (error) {
      const known = error instanceof WorkspaceHttpError;
      responseJson(response, known ? error.status : 500, {
        code: known ? error.code : "workspace_error",
        error: known ? error.message : "Workspace request failed",
      });
    }
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    releaseServiceLease();
    throw error;
  }
  const address = server.address();
  const localHost = isIP(host) === 6 ? `[${host}]` : host;
  serviceOrigin = externalOrigin ?? `http://${localHost}:${address.port}`;
  const timer = setInterval(() => cleanup().catch(() => {}), cleanupIntervalMs);
  timer.unref();

  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    try {
      await closeServer(server);
      await Promise.all(
        [...runtimes.values()].map(async (runtime) => {
          runtime.state = "stopping";
          await closeServer(runtime.viewer.server);
        }),
      );
    } finally {
      runtimes.clear();
      releaseServiceLease();
    }
  }

  return Object.freeze({
    server,
    store,
    origin: serviceOrigin,
    creationUrl: creationToken
      ? `${serviceOrigin}/#${creationToken}`
      : serviceOrigin,
    createWorkspace,
    resetWorkspace,
    cleanup,
    close,
  });
}
