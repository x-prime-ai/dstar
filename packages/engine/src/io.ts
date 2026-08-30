import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";

export function exists(path: string): boolean {
  try {
    fs.lstatSync(path);
    return true;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return false;
    throw error;
  }
}

/** Reject symlinks at every existing component, including package ancestors. */
export function safe(path: string): string {
  const resolved = resolve(path);
  const absolute =
    process.platform === "darwin"
      ? resolved.replace(/^\/(tmp|var)(?=\/|$)/, "/private/$1")
      : resolved;
  let part = absolute;
  while (true) {
    if (exists(part) && fs.lstatSync(part).isSymbolicLink())
      throw new Error(`Symlinks are not supported: ${part}`);
    const parent = dirname(part);
    if (parent === part) break;
    part = parent;
  }
  return absolute;
}

export function read(path: string, limit: number): Buffer {
  safe(path);
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.size > limit)
    throw new Error(`Invalid or oversized file: ${path}`);
  return fs.readFileSync(path);
}

export function syncDirectory(path: string): void {
  const fd = fs.openSync(path, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Persist newly created directory entries as well as the file's own parent. */
function mkdir(path: string): void {
  if (exists(path)) return;
  mkdir(dirname(path));
  fs.mkdirSync(path);
  syncDirectory(dirname(path));
}

export function atomic(path: string, bytes: Buffer | string): void {
  safe(path);
  mkdir(dirname(path));
  const temp = join(dirname(path), `.write-${randomUUID()}`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, path);
    syncDirectory(dirname(path));
  } finally {
    if (exists(temp)) fs.unlinkSync(temp);
  }
}
