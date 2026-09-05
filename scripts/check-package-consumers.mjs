import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "dstar-package-consumer-"));
const modules = join(temporary, "node_modules");
const packages = [
  ["@dstar/core", "packages/core"],
  ["@dstar/mcp", "packages/mcp"],
  ["@dstar/viewer", "apps/viewer"],
];

function packagePath(root, name) {
  return join(root, ...name.split("/"));
}

try {
  mkdirSync(modules, { recursive: true });
  for (const [name, relativeRoot] of packages) {
    const source = join(repositoryRoot, relativeRoot);
    const result = JSON.parse(
      execFileSync(
        "pnpm",
        ["pack", "--pack-destination", temporary, "--json"],
        { cwd: source, encoding: "utf8" },
      ),
    );
    const destination = packagePath(modules, name);
    mkdirSync(destination, { recursive: true });
    execFileSync(
      "tar",
      ["-xzf", result.filename, "-C", destination, "--strip-components=1"],
      { stdio: "pipe" },
    );
    const manifest = JSON.parse(
      readFileSync(join(destination, "package.json"), "utf8"),
    );
    for (const version of Object.values(manifest.dependencies ?? {}))
      if (String(version).startsWith("workspace:"))
        throw new Error(`${name} tarball contains a workspace dependency`);
  }

  for (const [, relativeRoot] of packages) {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, relativeRoot, "package.json"), "utf8"),
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith("@dstar/")) continue;
      const destination = packagePath(modules, dependency);
      if (
        lstatSync(
          packagePath(
            join(repositoryRoot, relativeRoot, "node_modules"),
            dependency,
          ),
          {
            throwIfNoEntry: false,
          },
        )
      ) {
        mkdirSync(dirname(destination), { recursive: true });
        if (!lstatSync(destination, { throwIfNoEntry: false }))
          symlinkSync(
            realpathSync(
              packagePath(
                join(repositoryRoot, relativeRoot, "node_modules"),
                dependency,
              ),
            ),
            destination,
            "junction",
          );
      } else {
        throw new Error(`Installed dependency is missing: ${dependency}`);
      }
    }
  }
  const nodeTypes = packagePath(modules, "@types/node");
  mkdirSync(dirname(nodeTypes), { recursive: true });
  symlinkSync(
    realpathSync(
      packagePath(join(repositoryRoot, "node_modules"), "@types/node"),
    ),
    nodeTypes,
    "junction",
  );

  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "dstar-package-consumer",
      private: true,
      type: "module",
    }),
  );
  writeFileSync(
    join(temporary, "smoke.mjs"),
    `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDocument } from "@dstar/core";
import { createDstarMcpServer } from "@dstar/mcp";
import { startViewer } from "@dstar/viewer";

const root = join(process.cwd(), "fixture");
const candidate = join(root, "candidate");
mkdirSync(candidate, { recursive: true });
writeFileSync(join(candidate, "document.html"), '<!doctype html><html><head><meta charset="utf-8"><title>Consumer</title></head><body><main data-dstar-id="main">Consumer</main></body></html>');
const document = openDocument(join(root, "document.dstar"));
const genesis = document.propose({ candidate, base: null, request: "Create", author: "consumer", key: "genesis" });
document.decide(genesis.id, "accept", genesis.revision, document.snapshot().stateId, "consumer");
const request = document.createRevisionRequest({ base: genesis.revision, instruction: "Revise", requester: "consumer", key: "request" });
if (request.status !== "submitted") throw new Error("Revision request API failed");
if (!createDstarMcpServer({ document, actor: { id: "consumer", displayName: "Consumer", role: "owner" }, capabilities: ["read"] })) throw new Error("MCP API failed");
if (typeof startViewer !== "function") throw new Error("Viewer API failed");
`,
  );
  writeFileSync(
    join(temporary, "smoke.ts"),
    `import { openDocument, type ActorIdentity } from "@dstar/core";
import { createDstarMcpServer } from "@dstar/mcp";
import { startViewer, type ViewerOptions } from "@dstar/viewer";

const actor: ActorIdentity = { id: "consumer", displayName: "Consumer", role: "owner" };
const document = openDocument("/tmp/compile-only.dstar");
createDstarMcpServer({ document, actor, capabilities: ["read", "propose"] });
const options: ViewerOptions = {
  basePath: "/review",
  agentInvocation: {
    identity: { id: "host-agent", displayName: "Host agent", role: "agent" },
    async invoke({ request, base }, { signal }) {
      signal.throwIfAborted();
      void request;
      return { files: base.files };
    },
  },
};
void startViewer("/tmp/compile-only.dstar", 0, options);
`,
  );
  writeFileSync(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["smoke.ts"],
    }),
  );
  execFileSync(process.execPath, [join(temporary, "smoke.mjs")], {
    cwd: temporary,
    stdio: "pipe",
  });
  execFileSync(
    join(repositoryRoot, "node_modules", ".bin", "tsc"),
    ["-p", join(temporary, "tsconfig.json")],
    { cwd: temporary, stdio: "pipe" },
  );
  console.log(
    "Packed Core, MCP and Viewer runtime imports and declarations passed in a clean consumer.",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
