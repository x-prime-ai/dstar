#!/usr/bin/env node
const args = process.argv.slice(2);
try {
  if (args[0] === "serve") {
    if (!args[1])
      throw new Error(
        "Usage: pnpm dstar serve <package-directory> [--port <0-65535>]",
      );
    let port = 0;
    if (args.length > 2) {
      if (
        args.length !== 4 ||
        args[2] !== "--port" ||
        !/^(0|[1-9][0-9]{0,4})$/.test(args[3])
      )
        throw new Error(
          "Usage: pnpm dstar serve <package-directory> [--port <0-65535>]",
        );
      port = Number(args[3]);
      if (port > 65535) throw new Error("Port must be between 0 and 65535");
    }
    const { startViewer } = await import("../apps/viewer/src/server.mjs");
    const viewer = await startViewer(args[1], port);
    console.log(
      `DSTAR Viewer Owner: ${viewer.ownerUrl}\nDSTAR Viewer Reviewer: ${viewer.reviewerUrl}\nKeep each role-specific URL private. Ctrl-C to stop.`,
    );
  } else {
    const { run } = await import("../packages/core/dist/cli.js");
    run(args);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
