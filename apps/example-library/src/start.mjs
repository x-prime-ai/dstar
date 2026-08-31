import { resolve } from "node:path";

import { startExampleLibrary } from "./server.mjs";

const service = await startExampleLibrary({
  port: Number(process.env.DSTAR_EXAMPLES_PORT ?? 8765),
  ...(process.env.DSTAR_EXAMPLES_RUNTIME
    ? { runtimeRoot: resolve(process.env.DSTAR_EXAMPLES_RUNTIME) }
    : {}),
});
console.log(`DSTAR Documents: ${service.url}`);

async function stop() {
  await service.close();
  process.exitCode = 0;
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
