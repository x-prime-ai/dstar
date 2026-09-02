import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer, request as requestHttp } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";

import { decisions } from "@dstar/engine/decisions";
import { open, readCandidate, revision } from "@dstar/engine";
import { startViewer } from "@dstar/viewer";

const SAMPLES = [
  {
    id: "dstar-doc",
    title: "DSTAR Product Brief",
    format: "document",
  },
  {
    id: "dstar-rich",
    title: "The document is the interface",
    format: "html",
  },
  {
    id: "dstar-slides",
    title: "Why we built DSTAR",
    format: "slides",
  },
  {
    id: "dstar-ui-design",
    title: "DSTAR Viewer UI",
    format: "ui-design",
  },
];

const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const PROXY_TOKEN_HEADER = "x-dstar-proxy-token";

function mountPath(value) {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string" ||
    !/^\/[a-z0-9](?:[a-z0-9-]{0,62})(?:\/[a-z0-9](?:[a-z0-9-]{0,62}))*$/.test(
      value,
    )
  )
    throw new Error("Invalid example library basePath");
  return value;
}

function proxyToken(value) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length < 48 ||
    value.length > 256 ||
    /[^A-Za-z0-9_-]/.test(value)
  )
    throw new Error("Invalid example library trusted proxy credential");
  return value;
}

function isTrustedProxy(request, expected) {
  if (!expected) return false;
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index].toLowerCase() === PROXY_TOKEN_HEADER) count++;
  const actual = request.headers[PROXY_TOKEN_HEADER];
  if (count !== 1 || typeof actual !== "string") return false;
  const left = Buffer.from(actual),
    right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function proxyHeaders(request, host, trustedProxy) {
  const critical = new Set(["host", "origin", "authorization", "content-type"]),
    seen = new Set();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (
      (!trustedProxy &&
        (name === "forwarded" || name.startsWith("x-forwarded-"))) ||
      (critical.has(name) && seen.has(name))
    )
      return null;
    seen.add(name);
  }
  const headers = { ...request.headers, host };
  for (const name of Object.keys(headers))
    if (
      HOP_BY_HOP.has(name.toLowerCase()) ||
      name.toLowerCase() === PROXY_TOKEN_HEADER ||
      name.toLowerCase() === "forwarded" ||
      name.toLowerCase().startsWith("x-forwarded-")
    )
      delete headers[name];
  return headers;
}

function proxyResponseHeaders(headers) {
  const safe = { ...headers };
  for (const name of Object.keys(safe))
    if (HOP_BY_HOP.has(name.toLowerCase())) delete safe[name];
  return safe;
}

function proxyViewer(request, response, viewer, path, trustedProxy) {
  const target = viewer.server.address(),
    authority = new URL(viewer.origin).host,
    headers = proxyHeaders(request, authority, trustedProxy);
  if (!headers) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end('{"error":"Invalid proxy headers"}\n');
    return;
  }
  const upstream = requestHttp({
    host: target.address,
    port: target.port,
    method: request.method,
    path,
    headers,
  });
  upstream.on("response", (incoming) => {
    response.writeHead(
      incoming.statusCode ?? 502,
      proxyResponseHeaders(incoming.headers),
    );
    incoming.pipe(response);
  });
  upstream.on("error", () => {
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end('{"error":"Viewer unavailable"}\n');
    }
  });
  request.pipe(upstream);
}

function seedPackage(packageRoot, candidateRoot) {
  mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  const engine = open(packageRoot);
  const snapshot = existsSync(join(packageRoot, ".dstar"))
    ? engine.snapshot()
    : { revision: null };
  const candidateRevision = revision(readCandidate(candidateRoot));
  if (snapshot.revision === candidateRevision) return;
  const proposal = engine.propose({
    candidate: candidateRoot,
    base: snapshot.revision,
    request:
      snapshot.revision === null
        ? "Create DSTAR example document"
        : "Update DSTAR example document",
    author: "example-library",
    key: `example-library-seed:${candidateRevision}`,
  });
  decisions(packageRoot).decide(
    proposal.id,
    "accept",
    proposal.revision,
    engine.snapshot().stateId,
    "example-library",
  );
}

function json(response, status, value) {
  const content = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": content.byteLength,
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(content);
}

function safeStaticPath(examplesRoot, pathname, libraryPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded === "/" || decoded === libraryPath) return "redirect";
  if (decoded === `${libraryPath}/`) return join(examplesRoot, "index.html");
  if (!decoded.startsWith(`${libraryPath}/`)) return null;
  const path = resolve(examplesRoot, decoded.slice(`${libraryPath}/`.length));
  const inside = relative(examplesRoot, path);
  if (!inside || inside.startsWith(`..${sep}`) || inside === "..") return null;
  return path;
}

function staticFile(response, path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": statSync(path).size,
    "Content-Type":
      TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(path).pipe(response);
}

export async function startExampleLibrary(options = {}) {
  const examplesRoot = resolve(
    options.examplesRoot ??
      new URL("../../../examples", import.meta.url).pathname,
  );
  const runtimeRoot = resolve(
    options.runtimeRoot ?? join(tmpdir(), "dstar-example-library-v1"),
  );
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8765;
  const basePath = mountPath(options.basePath),
    libraryPath = basePath || "/examples",
    documentsPath = `${basePath}/documents`,
    trustedProxyToken = proxyToken(options.trustedProxyToken);
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });

  const documents = [];
  let origin, controlAuthority;
  const server = createServer((request, response) => {
    const trustedProxy = isTrustedProxy(request, trustedProxyToken);
    if (
      trustedProxyToken
        ? !trustedProxy
        : request.headers.host !== controlAuthority
    ) {
      json(response, 403, { error: "Unknown local site" });
      return;
    }
    let url;
    try {
      url = new URL(request.url ?? "/", origin);
    } catch {
      json(response, 400, { error: "Invalid request target" });
      return;
    }
    const mounted = new RegExp(
      `^${documentsPath}/([a-z0-9][a-z0-9-]{0,62})(/.*)?$`,
    ).exec(url.pathname);
    if (mounted) {
      const document = documents.find(({ id }) => id === mounted[1]);
      if (!document) {
        json(response, 404, { error: "Document not found" });
        return;
      }
      if (!mounted[2]) {
        response.writeHead(308, {
          Location: `${url.pathname}/${url.search}`,
        });
        response.end();
        return;
      }
      proxyViewer(
        request,
        response,
        document.viewer,
        request.url,
        trustedProxy,
      );
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === `${libraryPath}/api/documents`
    ) {
      json(
        response,
        200,
        documents.map(({ viewer, ...document }) => ({
          ...document,
          viewerUrl: viewer.ownerUrl,
        })),
      );
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    const path = safeStaticPath(examplesRoot, url.pathname, libraryPath);
    if (path === "redirect") {
      response.writeHead(302, { Location: `${libraryPath}/` });
      response.end();
      return;
    }
    if (!path) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    staticFile(response, path);
  });

  try {
    await new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(port, host, accept);
    });
    const address = server.address();
    origin =
      options.externalOrigin === undefined
        ? `http://localhost:${address.port}`
        : options.externalOrigin;
    controlAuthority = new URL(origin).host;
    for (const sample of SAMPLES) {
      const packageRoot = join(runtimeRoot, `${sample.id}.dstar`);
      seedPackage(packageRoot, join(examplesRoot, sample.id));
      const viewer = await startViewer(packageRoot, 0, {
        externalOrigin: origin,
        basePath: `${documentsPath}/${sample.id}`,
        ownerToken: randomBytes(32).toString("hex"),
        ownerDisplayName: "Example owner",
      });
      documents.push({
        ...sample,
        viewer,
        previewUrl: `${libraryPath}/${sample.id}/document.html`,
      });
    }
  } catch (error) {
    await Promise.all(
      documents.map(
        ({ viewer }) => new Promise((accept) => viewer.server.close(accept)),
      ),
    );
    if (server.listening) await new Promise((accept) => server.close(accept));
    throw error;
  }

  async function close() {
    await new Promise((accept) => server.close(accept));
    await Promise.all(
      documents.map(
        ({ viewer }) => new Promise((accept) => viewer.server.close(accept)),
      ),
    );
  }
  return {
    server,
    origin,
    url: `${origin}${libraryPath}/`,
    documents: documents.map(({ viewer, ...document }) => ({
      ...document,
      viewerUrl: viewer.ownerUrl,
    })),
    close,
  };
}
