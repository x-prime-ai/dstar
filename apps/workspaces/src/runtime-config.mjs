import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute } from "node:path";

function fail(message) {
  throw new Error(message);
}

function integer(env, name, fallback, minimum = 1) {
  const value = env[name];
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    fail(`${name} must be a decimal integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    fail(`${name} is outside its supported range`);
  return parsed;
}

function secretFile(path) {
  if (typeof path !== "string" || !isAbsolute(path))
    fail("DSTAR_CREATION_TOKEN_FILE must be an absolute path");
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 258) fail("Invalid creation token file");
    return readFileSync(fd, "utf8").replace(/\r?\n$/, "");
  } catch {
    fail("Cannot read DSTAR_CREATION_TOKEN_FILE as a small regular file");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function workspaceConfigFromEnv(env = process.env) {
  for (const name of [
    "DSTAR_WORKSPACE_ROOT",
    "DSTAR_SEED_ROOT",
    "DSTAR_BIND_HOST",
    "DSTAR_PORT",
    "DSTAR_EXTERNAL_ORIGIN",
    "DSTAR_WORKSPACE_DOMAIN",
    "DSTAR_CREATION_TOKEN",
    "DSTAR_CREATION_TOKEN_FILE",
    "DSTAR_MAX_WORKSPACES",
    "DSTAR_MAX_WORKSPACE_MIB",
    "DSTAR_MAX_TOTAL_MIB",
    "DSTAR_WORKSPACE_TTL_SECONDS",
    "DSTAR_CLEANUP_INTERVAL_SECONDS",
  ])
    if (env[name] !== undefined && !env[name].trim())
      fail(`Empty ${name} is not allowed`);
  if (!env.DSTAR_WORKSPACE_ROOT || !isAbsolute(env.DSTAR_WORKSPACE_ROOT))
    fail("DSTAR_WORKSPACE_ROOT must be an absolute path");
  if (!env.DSTAR_SEED_ROOT || !isAbsolute(env.DSTAR_SEED_ROOT))
    fail("DSTAR_SEED_ROOT must be an absolute path");
  if (env.DSTAR_CREATION_TOKEN && env.DSTAR_CREATION_TOKEN_FILE)
    fail("Configure only one creation token source");
  const creationToken = env.DSTAR_CREATION_TOKEN_FILE
    ? secretFile(env.DSTAR_CREATION_TOKEN_FILE)
    : env.DSTAR_CREATION_TOKEN;
  if (
    env.DSTAR_EXTERNAL_ORIGIN &&
    (!env.DSTAR_WORKSPACE_DOMAIN || !creationToken)
  )
    fail("External service requires workspace domain and creation credential");
  const mebibyte = 1024 * 1024;
  return {
    root: env.DSTAR_WORKSPACE_ROOT,
    seedRoot: env.DSTAR_SEED_ROOT,
    host: env.DSTAR_BIND_HOST ?? "127.0.0.1",
    port: integer(env, "DSTAR_PORT", 0, 0),
    externalOrigin: env.DSTAR_EXTERNAL_ORIGIN,
    workspaceDomain: env.DSTAR_WORKSPACE_DOMAIN,
    creationToken,
    maxWorkspaces: integer(env, "DSTAR_MAX_WORKSPACES", 100),
    maxWorkspaceBytes: integer(env, "DSTAR_MAX_WORKSPACE_MIB", 64) * mebibyte,
    maxTotalBytes: integer(env, "DSTAR_MAX_TOTAL_MIB", 1024) * mebibyte,
    ttlMs: integer(env, "DSTAR_WORKSPACE_TTL_SECONDS", 86_400) * 1000,
    cleanupIntervalMs:
      integer(env, "DSTAR_CLEANUP_INTERVAL_SECONDS", 60) * 1000,
  };
}
