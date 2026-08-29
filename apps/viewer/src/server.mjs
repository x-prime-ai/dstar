import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, mediaType, resolveTarget } from "@dstar/engine";
import { decisions } from "@dstar/engine/decisions";
import { agentRoute } from "./agent-api.mjs";
import { createPreviewCache } from "./preview-cache.mjs";
import { fileDiff } from "./file-diff.mjs";
import {
  authorized,
  resolveViewerConfig,
  trustedRequestUrl,
  viewerOrigin,
} from "./runtime-config.mjs";

const publicFile = (path) =>
  readFileSync(new URL(`../public/${path}`, import.meta.url));
const secret = () => randomBytes(24).toString("hex");
export async function startViewer(root, port = 0, options = {}) {
  const config = resolveViewerConfig(root, port, options);
  const engine = open(config.root),
    review = decisions(config.root),
    token = config.token;
  engine.snapshot();
  const capabilities = createPreviewCache();
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
      const path = url.pathname;
      if (
        req.method === "GET" &&
        [
          "/",
          "/app.js",
          "/preview-state.js",
          "/review-state.js",
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
        return res.end(publicFile(path === "/" ? "index.html" : path.slice(1)));
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
      if (!path.startsWith("/api/") || !authorized(req, token))
        return json(401, { error: "Viewer authorization required" });
      if (req.headers.origin !== undefined && req.headers.origin !== origin)
        return json(403, { error: "Invalid review origin" });
      if (await agentRoute({ engine, req, json, path, origin })) return;
      if (req.method === "GET" && path === "/api/state") {
        const s = engine.snapshot();
        return json(200, {
          state: s.state,
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
      const diff = /^\/api\/diff\/([a-f0-9-]{36})$/.exec(path);
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
      const annotations = /^\/api\/annotations\/([a-f0-9-]{36})$/.exec(path);
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
      const preview = /^\/api\/preview\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === "GET" && preview) {
        const s = engine.snapshot(preview[1]),
          capability = secret();
        capabilities.set(capability, s);
        return json(200, {
          url: `/frame/${capability}/document.html`,
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
      if (path === "/api/comments")
        return json(
          201,
          engine.comment({
            target: body.target,
            body: body.body,
            author: "human",
          }),
        );
      const comment =
        /^\/api\/comments\/([a-f0-9-]{36})\/(reply|resolve)$/.exec(path);
      if (comment)
        return json(
          200,
          comment[2] === "reply"
            ? engine.reply(comment[1], body.body, "human")
            : review.resolveComment(comment[1], body.stateId),
        );
      const decision =
        /^\/api\/proposals\/([a-f0-9-]{36})\/(accept|reject)$/.exec(path);
      if (decision)
        return json(
          200,
          review.decide(
            decision[1],
            decision[2],
            body.revision,
            body.stateId,
            "human",
          ),
        );
      return json(404, { error: "Unknown route" });
    } catch (error) {
      return json(409, {
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  });
  server.once("close", () => capabilities.clear());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  origin = viewerOrigin(config, server.address().port);
  return { server, origin, url: `${origin}/#${token}` };
}
