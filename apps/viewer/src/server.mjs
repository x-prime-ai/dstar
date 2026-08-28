import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, mediaType, resolveTarget } from "@dstar/engine";
import { decisions } from "@dstar/engine/decisions";

const publicFile = (path) =>
  readFileSync(new URL(`../public/${path}`, import.meta.url));
const secret = () => randomBytes(24).toString("hex");
export async function startViewer(root, port = 0) {
  const engine = open(root),
    review = decisions(root),
    token = secret();
  engine.snapshot();
  const capabilities = new Map();
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
      if (req.headers.host !== new URL(origin).host)
        return json(403, { error: "Invalid host" });
      const url = new URL(req.url, origin),
        path = url.pathname;
      if (
        req.method === "GET" &&
        ["/", "/app.js", "/preview-state.js", "/style.css"].includes(path)
      ) {
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
        const capability = capabilities.get(frame[1]);
        if (!capability)
          return json(404, { error: "Expired preview; refresh" });
        const snapshot = engine.snapshot(capability.id),
          file = frame[2];
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
      if (
        !path.startsWith("/api/") ||
        req.headers.authorization !== `Bearer ${token}`
      )
        return json(401, { error: "Viewer authorization required" });
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
      const preview = /^\/api\/preview\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === "GET" && preview) {
        const s = engine.snapshot(preview[1]),
          capability = secret();
        if (capabilities.size >= 100)
          capabilities.delete(capabilities.keys().next().value);
        capabilities.set(capability, { id: preview[1] });
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
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/#${token}` };
}
