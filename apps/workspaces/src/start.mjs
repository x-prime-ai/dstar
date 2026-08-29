#!/usr/bin/env node
import { clearTimeout, setTimeout } from "node:timers";

import { workspaceConfigFromEnv } from "./runtime-config.mjs";
import { startWorkspaceService } from "./server.mjs";

try {
  const service = await startWorkspaceService(workspaceConfigFromEnv());
  console.log(`DSTAR workspace service listening at ${service.origin}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      service.server.closeAllConnections();
      process.exitCode = 1;
    }, 15_000);
    deadline.unref();
    try {
      await service.close();
    } finally {
      clearTimeout(deadline);
    }
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch {
  console.error(
    "DSTAR workspace startup failed. Check seed, storage, credential and origin configuration.",
  );
  process.exitCode = 1;
}
