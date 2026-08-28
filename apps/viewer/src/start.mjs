#!/usr/bin/env node
import { startViewer } from "./server.mjs";
import { viewerConfigFromEnv } from "./runtime-config.mjs";
import { clearTimeout, setTimeout } from "node:timers";

try {
  const { root, port, options } = viewerConfigFromEnv();
  const { server, origin } = await startViewer(root, port, options);
  // Persistent credentials never enter process output, command arguments or URLs.
  console.log(`DSTAR Viewer listening at ${origin}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exitCode = 1;
    }, 10000);
    deadline.unref();
    server.close(() => clearTimeout(deadline));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch {
  // Raw Engine/OS errors can include document paths or secret file names.
  console.error(
    "DSTAR Viewer startup failed. Check runtime configuration, credential source and package integrity/permissions.",
  );
  process.exitCode = 1;
}
