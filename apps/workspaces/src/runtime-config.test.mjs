import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { workspaceConfigFromEnv } from "./runtime-config.mjs";

const cleanup = [];
afterEach(() => {
  for (const path of cleanup.splice(0).reverse())
    rmSync(path, { recursive: true, force: true });
});

it("loads explicit external service boundaries without exposing secret paths", () => {
  const root = mkdtempSync(join(tmpdir(), "dstar-workspace-config-"));
  cleanup.push(root);
  const seed = join(root, "seed");
  const runtime = join(root, "runtime");
  const secret = join(root, "creation-token");
  mkdirSync(seed);
  writeFileSync(secret, `${"s".repeat(64)}\n`, { mode: 0o600 });
  expect(
    workspaceConfigFromEnv({
      DSTAR_WORKSPACE_ROOT: runtime,
      DSTAR_SEED_ROOT: seed,
      DSTAR_BIND_HOST: "0.0.0.0",
      DSTAR_PORT: "3000",
      DSTAR_EXTERNAL_ORIGIN: "https://manage.review.test",
      DSTAR_WORKSPACE_DOMAIN: "review.test",
      DSTAR_CREATION_TOKEN_FILE: secret,
      DSTAR_MAX_WORKSPACES: "12",
      DSTAR_MAX_WORKSPACE_MIB: "32",
      DSTAR_MAX_TOTAL_MIB: "256",
      DSTAR_WORKSPACE_TTL_SECONDS: "3600",
      DSTAR_CLEANUP_INTERVAL_SECONDS: "30",
    }),
  ).toMatchObject({
    root: runtime,
    seedRoot: seed,
    host: "0.0.0.0",
    port: 3000,
    creationToken: "s".repeat(64),
    maxWorkspaces: 12,
    maxWorkspaceBytes: 32 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
    ttlMs: 3_600_000,
    cleanupIntervalMs: 30_000,
  });
});

it("requires absolute roots and a complete external origin boundary", () => {
  expect(() =>
    workspaceConfigFromEnv({
      DSTAR_WORKSPACE_ROOT: "relative",
      DSTAR_SEED_ROOT: "/seed",
    }),
  ).toThrow("DSTAR_WORKSPACE_ROOT");
  expect(() =>
    workspaceConfigFromEnv({
      DSTAR_WORKSPACE_ROOT: "/runtime",
      DSTAR_SEED_ROOT: "/seed",
      DSTAR_EXTERNAL_ORIGIN: "https://manage.review.test",
    }),
  ).toThrow("requires workspace domain and creation credential");
  expect(() =>
    workspaceConfigFromEnv({
      DSTAR_WORKSPACE_ROOT: "/runtime",
      DSTAR_SEED_ROOT: "/seed",
      DSTAR_CREATION_TOKEN: "x".repeat(64),
      DSTAR_CREATION_TOKEN_FILE: "/secret",
    }),
  ).toThrow("only one creation token source");
});
