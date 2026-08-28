import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Files, Storage } from "./types.js";

export const MAX_FILE = 8 * 1024 * 1024;
export const MAX_TOTAL = 32 * 1024 * 1024;
export function digest(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function revision(files: Files): string {
  return digest(
    JSON.stringify([
      "dstar-static-v1",
      [...files]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([path, bytes]) => [path, digest(bytes), bytes.length]),
    ]),
  );
}

type Op = { copy: [number, number] } | { insert: string };
const BLOCK = 64;
const POWER = Array.from({ length: BLOCK - 1 }).reduce<number>(
  (v) => Math.imul(v, 31),
  1,
);
function checksum(bytes: Buffer, start: number): number {
  let h = 0;
  for (let i = start; i < start + BLOCK; i++)
    h = (Math.imul(h, 31) + bytes[i]!) | 0;
  return h;
}

/** Linear scanning copy/insert delta; exact byte verification, no fuzzy matching. */
export function createDelta(base: Buffer, next: Buffer): Buffer {
  const blocks = new Map<number, number[]>();
  for (let i = 0; i + BLOCK <= base.length; i += BLOCK) {
    const key = checksum(base, i);
    const offsets = blocks.get(key) ?? [];
    if (offsets.length < 16) offsets.push(i);
    blocks.set(key, offsets);
  }
  const ops: Op[] = [];
  let i = 0,
    pending = 0,
    h = next.length >= BLOCK ? checksum(next, 0) : 0;
  while (i + BLOCK <= next.length) {
    const offset = (blocks.get(h) ?? []).find((at) =>
      base.subarray(at, at + BLOCK).equals(next.subarray(i, i + BLOCK)),
    );
    if (offset !== undefined) {
      if (i > pending)
        ops.push({ insert: next.subarray(pending, i).toString("base64") });
      let size = BLOCK;
      while (
        offset + size < base.length &&
        i + size < next.length &&
        base[offset + size] === next[i + size]
      )
        size++;
      ops.push({ copy: [offset, size] });
      i += size;
      pending = i;
      if (i + BLOCK <= next.length) h = checksum(next, i);
    } else {
      h =
        (Math.imul((h - Math.imul(next[i]!, POWER)) | 0, 31) +
          (next[i + BLOCK] ?? 0)) |
        0;
      i++;
    }
  }
  if (pending < next.length)
    ops.push({ insert: next.subarray(pending).toString("base64") });
  return Buffer.from(JSON.stringify({ version: 1, ops }));
}

export function applyDelta(base: Buffer, raw: Buffer): Buffer {
  const data = JSON.parse(raw.toString("utf8")) as {
    version: number;
    ops: Op[];
  };
  if (
    data.version !== 1 ||
    !Array.isArray(data.ops) ||
    data.ops.length > MAX_FILE
  )
    throw new Error("Invalid delta");
  const chunks: Buffer[] = [];
  let size = 0;
  for (const op of data.ops) {
    let chunk: Buffer;
    if ("copy" in op) {
      const [at, count] = op.copy;
      if (
        !Number.isSafeInteger(at) ||
        !Number.isSafeInteger(count) ||
        at < 0 ||
        count < 0 ||
        at + count > base.length
      )
        throw new Error("Invalid delta copy");
      chunk = base.subarray(at, at + count);
    } else if (
      typeof op.insert === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(op.insert)
    )
      chunk = Buffer.from(op.insert, "base64");
    else throw new Error("Invalid delta insert");
    size += chunk.length;
    if (size > MAX_FILE) throw new Error("Delta output limit exceeded");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function encodeFile(
  base: Buffer | undefined,
  next: Buffer,
): { storage: Storage; bytes: Buffer } {
  const blob = gzipSync(next, { level: 9 });
  const delta = base ? gzipSync(createDelta(base, next), { level: 9 }) : null;
  const useDelta = delta !== null && delta.length + 32 < blob.length;
  const bytes = useDelta ? delta! : blob;
  return {
    bytes,
    storage: {
      encoding: useDelta ? "gzip-delta-v1" : "gzip-blob",
      object: digest(bytes),
      size: bytes.length,
    },
  };
}
export function decodeFile(
  base: Buffer | undefined,
  storage: Storage,
  bytes: Buffer,
): Buffer {
  if (digest(bytes) !== storage.object || bytes.length !== storage.size)
    throw new Error("Corrupt history object");
  const raw = gunzipSync(bytes, { maxOutputLength: MAX_FILE * 3 });
  if (storage.encoding === "gzip-blob") {
    if (raw.length > MAX_FILE) throw new Error("Blob output limit exceeded");
    return raw;
  }
  if (storage.encoding !== "gzip-delta-v1" || !base)
    throw new Error("Delta requires its exact base");
  return applyDelta(base, raw);
}
