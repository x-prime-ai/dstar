import { validatePackagePath } from "@dstar/core";
import type { PackageSnapshot } from "@dstar/node";

export interface SafeAssetResponse {
  readonly status: 200 | 404 | 415;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes?: Uint8Array;
}

export interface ResolvedImageAsset {
  readonly path: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

function detectedMediaType(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/u))
    return "image/gif";
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (new TextDecoder().decode(bytes.slice(0, 256)).match(/<svg(?:\s|>)/iu))
    return "image/svg+xml";
  if (
    new TextDecoder()
      .decode(bytes.slice(0, 256))
      .match(/<!doctype\s+html|<html(?:\s|>)/iu)
  )
    return "text/html";
  return undefined;
}

export function resolveSafeImage(
  snapshot: PackageSnapshot,
  path: string,
): ResolvedImageAsset | undefined {
  if (!validatePackagePath(path).valid) return undefined;
  const bytes = snapshot.readFile(path);
  if (!bytes) return undefined;
  const mediaType = detectedMediaType(bytes);
  if (
    mediaType !== "image/png" &&
    mediaType !== "image/jpeg" &&
    mediaType !== "image/gif" &&
    mediaType !== "image/webp"
  )
    return undefined;
  return { path, mediaType };
}

export function safeAssetResponse(
  snapshot: PackageSnapshot,
  path: string,
): SafeAssetResponse {
  const baseHeaders = Object.freeze({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  });
  if (!validatePackagePath(path).valid)
    return { status: 404, headers: baseHeaders };
  const bytes = snapshot.readFile(path);
  if (!bytes) return { status: 404, headers: baseHeaders };
  const mediaType = detectedMediaType(bytes);
  const active = mediaType === "image/svg+xml" || mediaType === "text/html";
  if (!mediaType)
    return {
      status: 415,
      headers: Object.freeze({
        ...baseHeaders,
        "Content-Disposition": "attachment",
        "Content-Type": "application/octet-stream",
      }),
    };
  return {
    status: 200,
    headers: Object.freeze({
      ...baseHeaders,
      "Content-Disposition": active ? "attachment" : "inline",
      "Content-Type": mediaType,
    }),
    bytes,
  };
}
