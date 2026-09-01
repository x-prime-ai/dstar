import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { startExampleLibrary } from "./server.mjs";

function proxyToken(env) {
  if (env.DSTAR_EXAMPLES_PROXY_TOKEN && env.DSTAR_EXAMPLES_PROXY_TOKEN_FILE)
    throw new Error("Configure one example proxy credential source");
  if (!env.DSTAR_EXAMPLES_PROXY_TOKEN_FILE)
    return env.DSTAR_EXAMPLES_PROXY_TOKEN;
  const path = env.DSTAR_EXAMPLES_PROXY_TOKEN_FILE;
  if (!isAbsolute(path))
    throw new Error("Invalid example proxy credential file");
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > 258)
      throw new Error("Invalid example proxy credential file");
    return readFileSync(descriptor, "utf8").replace(/\r?\n$/, "");
  } catch {
    throw new Error("Cannot read example proxy credential file");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const service = await startExampleLibrary({
  port: Number(process.env.DSTAR_EXAMPLES_PORT ?? 8765),
  host: process.env.DSTAR_EXAMPLES_BIND_HOST,
  externalOrigin: process.env.DSTAR_EXAMPLES_EXTERNAL_ORIGIN,
  basePath: process.env.DSTAR_EXAMPLES_BASE_PATH,
  trustedProxyToken: proxyToken(process.env),
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
