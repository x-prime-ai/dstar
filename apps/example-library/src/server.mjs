import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
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
    title: "Review the document",
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

function safeStaticPath(examplesRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded === "/" || decoded === "/examples") return "redirect";
  if (decoded === "/examples/") return join(examplesRoot, "index.html");
  if (!decoded.startsWith("/examples/")) return null;
  const path = resolve(examplesRoot, decoded.slice("/examples/".length));
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
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });

  const documents = [];
  for (const sample of SAMPLES) {
    const packageRoot = join(runtimeRoot, `${sample.id}.dstar`);
    seedPackage(packageRoot, join(examplesRoot, sample.id));
    const viewer = await startViewer(packageRoot, 0, {
      ownerToken: randomBytes(32).toString("hex"),
      ownerDisplayName: "Example owner",
    });
    documents.push({
      ...sample,
      viewer,
      previewUrl: `/examples/${sample.id}/document.html`,
    });
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/documents") {
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
    const path = safeStaticPath(examplesRoot, url.pathname);
    if (path === "redirect") {
      response.writeHead(302, { Location: "/examples/" });
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
  } catch (error) {
    await Promise.all(
      documents.map(
        ({ viewer }) => new Promise((accept) => viewer.server.close(accept)),
      ),
    );
    throw error;
  }

  const address = server.address();
  const origin = `http://${host}:${address.port}`;
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
    url: `${origin}/examples/`,
    documents: documents.map(({ viewer, ...document }) => ({
      ...document,
      viewerUrl: viewer.ownerUrl,
    })),
    close,
  };
}
