import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const WORKSPACE_ID = /^[a-f0-9]{32}$/;
const METADATA_VERSION = 1;
const DEFAULTS = Object.freeze({
  maxWorkspaces: 100,
  maxWorkspaceBytes: 64 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  ttlMs: 24 * 60 * 60 * 1000,
  lockTimeoutMs: 30_000,
});

function fail(message) {
  throw new Error(message);
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0)
    fail(`${name} must be positive`);
  return value;
}

function existingPhysical(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) fail("Workspace paths must not contain symlinks");
  return path;
}

function safeRoot(path, name) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))
    fail(`${name} must be an absolute path`);
  const resolved = resolve(path);
  const result =
    process.platform === "darwin"
      ? resolved.replace(/^\/(tmp|var)(?=\/|$)/, "/private/$1")
      : resolved;
  let cursor = result;
  while (true) {
    if (existsSync(cursor)) existingPhysical(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return result;
}

function contains(parent, child) {
  const value = relative(parent, child);
  return (
    !value ||
    (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value))
  );
}

function syncDirectory(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicJson(path, value, mode = 0o600) {
  const temporary = `${path}.write-${randomBytes(12).toString("hex")}`;
  const fd = openSync(temporary, "wx", mode);
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

function boundedTree(root, limit, copyTo) {
  let bytes = 0;
  let entries = 0;
  const digest = createHash("sha256");
  const walk = (source, destination, depth) => {
    if (depth > 32) fail("Seed directory is too deep");
    if (copyTo) mkdirSync(destination, { mode: 0o700 });
    const children = readdirSync(source, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      if (++entries > 8192) fail("Seed has too many directory entries");
      const sourcePath = join(source, child.name);
      const destinationPath = copyTo ? join(destination, child.name) : "";
      const entryInfo = lstatSync(sourcePath);
      if (child.isSymbolicLink() || entryInfo.isSymbolicLink())
        fail("Seed must not contain symlinks");
      if (child.isDirectory() && entryInfo.isDirectory()) {
        digest.update(`d\0${child.name}\0`);
        walk(sourcePath, destinationPath, depth + 1);
      } else if (child.isFile() && entryInfo.isFile()) {
        const fd = openSync(
          sourcePath,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        let content;
        let info;
        try {
          info = fstatSync(fd);
          if (!info.isFile()) fail("Seed may contain only regular files");
          bytes += info.size;
          if (bytes > limit) fail("Seed exceeds the workspace byte limit");
          content = readFileSync(fd);
        } finally {
          closeSync(fd);
        }
        digest.update(`f\0${child.name}\0${content.byteLength}\0`);
        digest.update(content);
        if (copyTo)
          writeFileSync(destinationPath, content, {
            flag: "wx",
            mode: info.mode & 0o111 ? 0o700 : 0o600,
          });
      } else fail("Seed may contain only regular files and directories");
    }
  };
  walk(root, copyTo, 0);
  return { bytes, digest: digest.digest("hex") };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validMetadata(value, expectedId) {
  if (
    !value ||
    value.version !== METADATA_VERSION ||
    value.id !== expectedId ||
    !WORKSPACE_ID.test(value.id) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    typeof value.createdAt !== "string" ||
    typeof value.lastAccessAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.seedDigest !== "string"
  )
    fail("Corrupt workspace metadata");
  return value;
}

function sameToken(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return left.equals(right);
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export function workspaceStore(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    fail("Workspace store options are required");
  const root = safeRoot(options.root, "root");
  const seedRoot = safeRoot(options.seedRoot, "seedRoot");
  if (!existsSync(seedRoot) || !lstatSync(seedRoot).isDirectory())
    fail("seedRoot must be an existing directory");
  if (contains(seedRoot, root) || contains(root, seedRoot))
    fail("seedRoot and workspace storage must be separate trees");
  if (!existsSync(join(seedRoot, ".dstar", "state.json")))
    fail("seedRoot must be an initialized HTML-first DSTAR package");
  const limits = Object.freeze({
    maxWorkspaces: positiveInteger(
      options.maxWorkspaces ?? DEFAULTS.maxWorkspaces,
      "maxWorkspaces",
    ),
    maxWorkspaceBytes: positiveInteger(
      options.maxWorkspaceBytes ?? DEFAULTS.maxWorkspaceBytes,
      "maxWorkspaceBytes",
    ),
    maxTotalBytes: positiveInteger(
      options.maxTotalBytes ?? DEFAULTS.maxTotalBytes,
      "maxTotalBytes",
    ),
    ttlMs: positiveInteger(options.ttlMs ?? DEFAULTS.ttlMs, "ttlMs"),
    lockTimeoutMs: positiveInteger(
      options.lockTimeoutMs ?? DEFAULTS.lockTimeoutMs,
      "lockTimeoutMs",
    ),
  });
  const now = options.now ?? (() => Date.now());
  const randomId = options.randomId ?? (() => randomBytes(16).toString("hex"));
  const randomToken =
    options.randomToken ?? (() => randomBytes(36).toString("base64url"));
  const makeSession =
    options.createSessionConfig ??
    (({ ownerToken, randomToken }) => {
      const reviewerToken = randomToken();
      return {
        ownerToken,
        reviewerToken,
        viewerOptions: {
          ownerToken,
          reviewerToken,
          ownerDisplayName: "Workspace Owner",
          reviewerDisplayName: "Workspace Reviewer",
        },
      };
    });
  mkdirSync(join(root, "workspaces"), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, ".locks"), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, ".staging"), { recursive: true, mode: 0o700 });
  const seed = boundedTree(seedRoot, limits.maxWorkspaceBytes);

  const workspacePath = (id) => {
    if (!WORKSPACE_ID.test(id)) fail("Invalid workspace id");
    return join(root, "workspaces", id);
  };
  const metadata = (id) =>
    validMetadata(readJson(join(workspacePath(id), "metadata.json")), id);
  const credentials = (id, generation) => {
    const value = readJson(
      join(
        workspacePath(id),
        "generations",
        String(generation),
        "credentials.json",
      ),
    );
    if (
      !value ||
      typeof value.ownerToken !== "string" ||
      !/^[A-Za-z0-9_-]{48,256}$/.test(value.ownerToken) ||
      !value.viewerOptions ||
      typeof value.viewerOptions !== "object" ||
      Array.isArray(value.viewerOptions)
    )
      fail("Corrupt workspace credentials");
    return value;
  };
  const list = () =>
    readdirSync(join(root, "workspaces"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && WORKSPACE_ID.test(entry.name))
      .map((entry) => metadata(entry.name));
  const diskUsage = () => {
    let total = 0;
    for (const item of list())
      total += boundedTree(
        workspacePath(item.id),
        Number.MAX_SAFE_INTEGER,
      ).bytes;
    return total;
  };

  async function locked(name, operation) {
    const path = join(root, ".locks", `${name}.lock`);
    const started = now();
    while (true) {
      try {
        const fd = openSync(path, "wx", 0o600);
        try {
          writeFileSync(
            fd,
            JSON.stringify({ pid: process.pid, createdAt: now() }),
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let stale = false;
        try {
          const owner = readJson(path);
          stale = !processAlive(owner.pid);
        } catch {
          stale = false;
        }
        if (stale) {
          rmSync(path, { force: true });
          continue;
        }
        if (now() - started >= limits.lockTimeoutMs)
          fail("Workspace operation lock timed out");
        await delay(10);
      }
    }
    try {
      return await operation();
    } finally {
      rmSync(path, { force: true });
    }
  }

  function writeGeneration(parent, generation) {
    const generationRoot = join(parent, "generations", String(generation));
    mkdirSync(join(parent, "generations"), { recursive: true, mode: 0o700 });
    mkdirSync(generationRoot, { mode: 0o700 });
    const copied = boundedTree(
      seedRoot,
      limits.maxWorkspaceBytes,
      join(generationRoot, "package"),
    );
    if (copied.digest !== seed.digest)
      fail("Seed changed while it was being copied");
    const ownerToken = randomToken();
    const session = makeSession({ ownerToken, randomToken });
    if (!session || session.ownerToken !== ownerToken || !session.viewerOptions)
      fail(
        "createSessionConfig must preserve ownerToken and return viewerOptions",
      );
    atomicJson(join(generationRoot, "credentials.json"), session);
    return session;
  }

  async function create() {
    return locked("catalog", async () => {
      const current = list();
      if (current.length >= limits.maxWorkspaces)
        fail("Workspace count limit reached");
      if (diskUsage() + seed.bytes > limits.maxTotalBytes)
        fail("Workspace disk limit reached");
      let id;
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = randomId();
        if (
          WORKSPACE_ID.test(candidate) &&
          !existsSync(workspacePath(candidate))
        ) {
          id = candidate;
          break;
        }
      }
      if (!id) fail("Could not allocate a unique workspace id");
      const temporary = join(
        root,
        ".staging",
        `${id}-${randomBytes(8).toString("hex")}`,
      );
      mkdirSync(temporary, { mode: 0o700 });
      try {
        const session = writeGeneration(temporary, 1);
        const created = new Date(now()).toISOString();
        const record = {
          version: METADATA_VERSION,
          id,
          generation: 1,
          createdAt: created,
          lastAccessAt: created,
          expiresAt: new Date(now() + limits.ttlMs).toISOString(),
          seedDigest: seed.digest,
        };
        atomicJson(join(temporary, "metadata.json"), record);
        renameSync(temporary, workspacePath(id));
        syncDirectory(join(root, "workspaces"));
        return { metadata: record, credentials: session };
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });
  }

  function load(id) {
    const record = metadata(id);
    const session = credentials(id, record.generation);
    return {
      metadata: record,
      credentials: session,
      packageRoot: join(
        workspacePath(id),
        "generations",
        String(record.generation),
        "package",
      ),
    };
  }

  async function reset(id, ownerToken, beforePublish = async () => {}) {
    if (typeof beforePublish !== "function")
      fail("beforePublish must be a function");
    return locked("catalog", () =>
      locked(`workspace-${id}`, async () => {
        const before = load(id);
        if (!sameToken(ownerToken, before.credentials.ownerToken))
          fail("Workspace owner authorization required");
        if (diskUsage() + seed.bytes > limits.maxTotalBytes)
          fail("Workspace disk limit reached during reset");
        const generation = before.metadata.generation + 1;
        const generationRoot = join(
          workspacePath(id),
          "generations",
          String(generation),
        );
        let published = false;
        let session;
        let record;
        try {
          session = writeGeneration(workspacePath(id), generation);
          const resetAt = new Date(now()).toISOString();
          record = {
            ...before.metadata,
            generation,
            lastAccessAt: resetAt,
            expiresAt: new Date(now() + limits.ttlMs).toISOString(),
            seedDigest: seed.digest,
          };
          const prepared = {
            metadata: record,
            credentials: session,
            packageRoot: join(generationRoot, "package"),
          };
          // Keep the old metadata and credentials authoritative until the
          // caller proves the new generation can be served.
          await beforePublish(prepared);
          atomicJson(join(workspacePath(id), "metadata.json"), record);
          published = true;
        } finally {
          if (!published)
            rmSync(generationRoot, { recursive: true, force: true });
        }
        for (const entry of readdirSync(
          join(workspacePath(id), "generations"),
          { withFileTypes: true },
        ))
          if (entry.isDirectory() && entry.name !== String(generation))
            rmSync(join(workspacePath(id), "generations", entry.name), {
              recursive: true,
              force: true,
            });
        return {
          metadata: record,
          credentials: session,
          packageRoot: join(
            workspacePath(id),
            "generations",
            String(generation),
            "package",
          ),
        };
      }),
    );
  }

  function authorize(id, ownerToken) {
    const current = load(id);
    return sameToken(ownerToken, current.credentials.ownerToken);
  }

  async function touch(id) {
    return locked(`workspace-${id}`, async () => {
      const record = metadata(id);
      const touched = new Date(now()).toISOString();
      const next = {
        ...record,
        lastAccessAt: touched,
        expiresAt: new Date(now() + limits.ttlMs).toISOString(),
      };
      atomicJson(join(workspacePath(id), "metadata.json"), next);
      return next;
    });
  }

  function expired() {
    return list()
      .filter((item) => Date.parse(item.expiresAt) <= now())
      .map((item) => item.id);
  }

  function isExpired(id) {
    return Date.parse(metadata(id).expiresAt) <= now();
  }

  async function remove(id, options = {}) {
    return locked("catalog", () =>
      locked(`workspace-${id}`, async () => {
        if (options.expiredOnly && !isExpired(id)) return false;
        rmSync(workspacePath(id), { recursive: true, force: true });
        syncDirectory(join(root, "workspaces"));
        return true;
      }),
    );
  }

  function recover() {
    for (const entry of readdirSync(join(root, ".staging")))
      rmSync(join(root, ".staging", entry), { recursive: true, force: true });
    for (const item of list()) {
      const generations = join(workspacePath(item.id), "generations");
      for (const entry of readdirSync(generations, { withFileTypes: true }))
        if (entry.isDirectory() && entry.name !== String(item.generation))
          rmSync(join(generations, entry.name), {
            recursive: true,
            force: true,
          });
    }
  }

  function acquireServiceLease() {
    const path = join(root, ".service.lock");
    const nonce = randomBytes(16).toString("hex");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(path, "wx", 0o600);
        try {
          writeFileSync(
            fd,
            JSON.stringify({ pid: process.pid, nonce, createdAt: now() }),
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return () => {
          try {
            if (readJson(path).nonce === nonce) rmSync(path, { force: true });
          } catch {
            // Never remove a lease that cannot be proven to be ours.
          }
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let owner;
        try {
          owner = readJson(path);
        } catch {
          fail("Workspace service lease is corrupt; inspect it before restart");
        }
        if (processAlive(owner.pid))
          fail("Workspace storage is already served by another process");
        rmSync(path, { force: true });
      }
    }
    fail("Could not acquire workspace service lease");
  }

  return Object.freeze({
    root,
    seedRoot,
    limits,
    create,
    load,
    authorize,
    reset,
    touch,
    expired,
    isExpired,
    remove,
    list,
    diskUsage,
    recover,
    acquireServiceLease,
  });
}
