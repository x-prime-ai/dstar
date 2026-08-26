export type PackagePathErrorCode =
  | "empty"
  | "absolute"
  | "empty-segment"
  | "dot-segment"
  | "backslash"
  | "colon";

export interface PackagePathValidation {
  readonly valid: boolean;
  readonly code?: PackagePathErrorCode;
}

export function validatePackagePath(path: string): PackagePathValidation {
  if (path.length === 0) return { valid: false, code: "empty" };
  if (path.startsWith("/")) return { valid: false, code: "absolute" };
  if (path.includes("\\")) return { valid: false, code: "backslash" };
  if (path.includes(":")) return { valid: false, code: "colon" };
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0))
    return { valid: false, code: "empty-segment" };
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { valid: false, code: "dot-segment" };
  }
  return { valid: true };
}

export function isPackagePath(path: string): boolean {
  return validatePackagePath(path).valid;
}
