#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { openHost } from "../packages/engine/dist/host.js";
import { open } from "../packages/engine/dist/index.js";

const destination = process.argv[2];
const candidate = resolve(process.argv[3] ?? "examples/html-first");
if (!destination || !isAbsolute(destination)) {
  console.error(
    "Usage: pnpm workspace:seed /absolute/seed.dstar [candidate-directory]",
  );
  process.exitCode = 1;
} else if (existsSync(destination) && readdirSync(destination).length) {
  console.error("Seed destination must be absent or empty.");
  process.exitCode = 1;
} else {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const engine = open(destination);
  const proposal = engine.propose({
    candidate,
    base: null,
    request: "Create immutable workspace seed",
    author: "seed-builder",
    key: "workspace-seed-v1",
  });
  const snapshot = engine.snapshot();
  openHost(destination).decide(
    proposal.id,
    "accept",
    proposal.revision,
    snapshot.stateId,
    "seed-builder",
  );
  console.log(`Workspace seed created at ${destination}`);
}
