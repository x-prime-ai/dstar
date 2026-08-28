import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { open, readCandidate, revision, validateHtml } from "./index.js";
import type { Target } from "./types.js";

export function run(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      candidate: { type: "string" },
      base: { type: "string" },
      request: { type: "string" },
      author: { type: "string" },
      key: { type: "string" },
      revision: { type: "string" },
      out: { type: "string" },
      target: { type: "string" },
      body: { type: "string" },
      comment: { type: "string" },
    },
  });
  const [command, root] = positionals;
  if (!command || !root)
    throw new Error(
      "Usage: pnpm dstar <validate|propose|inspect|export|comment|reply|serve> <directory> [options]",
    );
  const required = (name: keyof typeof values): string => {
    const value = values[name];
    if (typeof value !== "string" || !value)
      throw new Error(`Missing --${name}`);
    return value;
  };
  let result: unknown;
  if (command === "validate") {
    const files = readCandidate(root);
    result = { revision: revision(files), index: validateHtml(files) };
  } else {
    const engine = open(root);
    switch (command) {
      case "propose":
        result = engine.propose({
          candidate: required("candidate"),
          base: required("base") === "none" ? null : required("base"),
          request: required("request"),
          author: values.author ?? "agent",
          key: required("key"),
        });
        break;
      case "inspect": {
        const s = engine.snapshot(values.revision);
        result = {
          state: s.state,
          stateId: s.stateId,
          revision: s.revision,
          index: s.index,
          files: [...s.files].map(([path, bytes]) => ({
            path,
            size: bytes.length,
          })),
        };
        break;
      }
      case "export":
        result = engine.export(required("out"), values.revision);
        break;
      case "comment":
        result = engine.comment({
          target: JSON.parse(
            readFileSync(required("target"), "utf8"),
          ) as Target,
          body: required("body"),
          author: values.author ?? "agent",
        });
        break;
      case "reply":
        result = engine.reply(
          required("comment"),
          required("body"),
          values.author ?? "agent",
        );
        break;
      default:
        throw new Error(
          `Unknown agent command: ${command}. Accept/reject/resolve are human Viewer actions.`,
        );
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
