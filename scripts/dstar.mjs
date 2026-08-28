#!/usr/bin/env node
const args = process.argv.slice(2);
try {
  if (args[0] === "serve") {
    if (!args[1])
      throw new Error("Usage: pnpm dstar serve <package-directory>");
    const { startViewer } = await import("../apps/viewer/src/server.mjs");
    const viewer = await startViewer(args[1]);
    console.log(
      `DSTAR Viewer: ${viewer.url}\nLocal human review session. Keep this URL private. Ctrl-C to stop.`,
    );
  } else {
    const { run } = await import("../packages/engine/dist/cli.js");
    run(args);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
