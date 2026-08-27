import {
  createDiagnostic,
  documentRevision,
  parseIJson,
  projectionRevision,
  sha256Hex,
  validateInMemoryPackage,
  validatePackagePath,
  type Diagnostic,
  type DstarAnnotation,
  type DstarChange,
  type DstarDocument,
  type DstarManifest,
  type DstarNode,
  type DstarProjectionIndex,
  type DstarSources,
  type InMemoryPackage,
} from "@dstar/core";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface PackageLimits {
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
  readonly maxJsonBytes: number;
  readonly maxProjectionBytes: number;
  readonly maxAssetBytes: number;
  readonly maxPathBytes: number;
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = Object.freeze({
  maxTotalBytes: 256 * 1024 * 1024,
  maxFiles: 200_000,
  maxJsonBytes: 8 * 1024 * 1024,
  maxProjectionBytes: 32 * 1024 * 1024,
  maxAssetBytes: 128 * 1024 * 1024,
  maxPathBytes: 1_024,
});

export type PackageOpenMode = "strict" | "inspect";

export interface InventoryFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface OpenPackageOptions {
  readonly mode?: PackageOpenMode;
  readonly limits?: Partial<PackageLimits>;
}

export class PackageOpenError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[]) {
    super(message);
    this.name = "PackageOpenError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

export class PackageSnapshot implements InMemoryPackage {
  readonly root: string;
  readonly snapshotId: string;
  readonly inventory: readonly InventoryFile[];
  readonly manifest: DstarManifest;
  readonly document: DstarDocument;
  readonly annotations: readonly DstarAnnotation[];
  readonly changes: readonly DstarChange[];
  readonly sources?: DstarSources;
  readonly projections?: DstarProjectionIndex;
  readonly diagnostics: readonly Diagnostic[];
  readonly writable: boolean;
  readonly #bytes: ReadonlyMap<string, Uint8Array>;

  constructor(input: {
    root: string;
    snapshotId: string;
    inventory: readonly InventoryFile[];
    pkg: InMemoryPackage;
    bytes: ReadonlyMap<string, Uint8Array>;
    diagnostics: readonly Diagnostic[];
  }) {
    this.root = input.root;
    this.snapshotId = input.snapshotId;
    this.inventory = Object.freeze([...input.inventory]);
    this.manifest = input.pkg.manifest;
    this.document = input.pkg.document;
    this.annotations = Object.freeze([...input.pkg.annotations]);
    this.changes = Object.freeze([...input.pkg.changes]);
    if (input.pkg.sources) this.sources = input.pkg.sources;
    if (input.pkg.projections) this.projections = input.pkg.projections;
    this.diagnostics = Object.freeze([...input.diagnostics]);
    this.writable = !this.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    );
    this.#bytes = new Map(input.bytes);
    Object.freeze(this);
  }

  readFile(path: string): Uint8Array | undefined {
    const bytes = this.#bytes.get(path);
    return bytes ? new Uint8Array(bytes) : undefined;
  }

  hasFile(path: string): boolean {
    return this.#bytes.has(path);
  }
}

function packagePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function sizeLimitFor(path: string, limits: PackageLimits): number {
  if (path.startsWith("assets/")) return limits.maxAssetBytes;
  if (path.startsWith("projections/") && !path.endsWith("index.json")) {
    return limits.maxProjectionBytes;
  }
  if (path.endsWith(".json")) return limits.maxJsonBytes;
  return limits.maxProjectionBytes;
}

async function safeInventory(
  root: string,
  limits: PackageLimits,
): Promise<{
  inventory: InventoryFile[];
  bytes: Map<string, Uint8Array>;
}> {
  const inventory: InventoryFile[] = [];
  const bytes = new Map<string, Uint8Array>();
  const stack = [root];
  let totalBytes = 0;

  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) break;
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = packagePath(root, absolutePath);
      const pathValidation = validatePackagePath(path);
      if (
        !pathValidation.valid ||
        new TextEncoder().encode(path).byteLength > limits.maxPathBytes
      ) {
        throw new PackageOpenError("Unsafe package path", [
          createDiagnostic("PKG_PATH_INVALID", {
            summary: `Package path ${path} is invalid or too long.`,
            location: { packagePath: path },
            details: { reason: pathValidation.code ?? "path-length" },
          }),
        ]);
      }
      const metadata = await lstat(absolutePath);
      if (
        metadata.isSymbolicLink() ||
        (!metadata.isDirectory() && !metadata.isFile())
      ) {
        throw new PackageOpenError("Unsafe package file type", [
          createDiagnostic("PKG_PATH_INVALID", {
            summary: `Package entry ${path} is a link or special file.`,
            location: { packagePath: path },
          }),
        ]);
      }
      const resolvedEntry = await realpath(absolutePath);
      if (
        resolvedEntry !== root &&
        !resolvedEntry.startsWith(`${root}${sep}`)
      ) {
        throw new PackageOpenError("Package entry escapes root", [
          createDiagnostic("PKG_PATH_INVALID", {
            summary: `Package entry ${path} resolves outside the package root.`,
            location: { packagePath: path },
          }),
        ]);
      }
      if (metadata.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (inventory.length >= limits.maxFiles) {
        throw new PackageOpenError("Package file count limit exceeded", [
          createDiagnostic("LIMIT_EXCEEDED", {
            summary: "Package file count limit exceeded.",
          }),
        ]);
      }
      if (metadata.size > sizeLimitFor(path, limits)) {
        throw new PackageOpenError("Package entry size limit exceeded", [
          createDiagnostic("LIMIT_EXCEEDED", {
            summary: `Package entry ${path} exceeds its size limit.`,
            location: { packagePath: path },
          }),
        ]);
      }
      totalBytes += metadata.size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new PackageOpenError("Package total size limit exceeded", [
          createDiagnostic("LIMIT_EXCEEDED", {
            summary: "Package total size limit exceeded.",
          }),
        ]);
      }
      const fileBytes = new Uint8Array(await readFile(absolutePath));
      bytes.set(path, fileBytes);
      inventory.push(
        Object.freeze({
          path,
          size: fileBytes.byteLength,
          sha256: sha256Hex(fileBytes),
        }),
      );
    }
  }
  inventory.sort((left, right) => left.path.localeCompare(right.path));
  return { inventory, bytes };
}

function requiredBytes(
  bytes: ReadonlyMap<string, Uint8Array>,
  path: string,
): Uint8Array {
  const value = bytes.get(path);
  if (!value) {
    throw new PackageOpenError(`Required entry ${path} is missing`, [
      createDiagnostic("PKG_ENTRY_MISSING", {
        summary: `Required package entry ${path} is missing.`,
        location: { packagePath: path },
      }),
    ]);
  }
  return value;
}

function parseJson<T>(bytes: Uint8Array, path: string): T {
  try {
    return parseIJson(bytes).value as T;
  } catch (error) {
    throw new PackageOpenError(`Could not parse ${path}`, [
      createDiagnostic("JSON_PARSE_FAILED", {
        summary:
          error instanceof Error ? error.message : `Could not parse ${path}.`,
        location: { packagePath: path },
      }),
    ]);
  }
}

function jsonObjectsIn<T>(
  bytes: ReadonlyMap<string, Uint8Array>,
  directory: string,
): T[] {
  return [...bytes]
    .filter(
      ([path]) =>
        path.startsWith(`${directory}/`) &&
        !path.slice(directory.length + 1).includes("/") &&
        path.endsWith(".json"),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => parseJson<T>(value, path));
}

function snapshotIdentifier(inventory: readonly InventoryFile[]): string {
  const lines = inventory
    .map(
      (file) => `${file.path}\u0000file\u0000${file.size}\u0000${file.sha256}`,
    )
    .join("\n");
  return `snapshot:${sha256Hex(new TextEncoder().encode(lines))}`;
}

function validateNodeFileNames(
  pkg: InMemoryPackage,
  bytes: ReadonlyMap<string, Uint8Array>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const annotation of pkg.annotations) {
    if (!bytes.has(`annotations/${annotation.id}.json`)) {
      diagnostics.push(
        createDiagnostic("REF_MISSING", {
          summary: "Annotation filename must match its ID.",
          location: { objectId: annotation.id },
        }),
      );
    }
  }
  for (const change of pkg.changes) {
    if (!bytes.has(`changes/${change.id}.json`)) {
      diagnostics.push(
        createDiagnostic("REF_MISSING", {
          summary: "Change filename must match its ID.",
          location: { objectId: change.id },
        }),
      );
    }
  }
  return diagnostics;
}

function validateArtifacts(
  pkg: InMemoryPackage,
  bytes: ReadonlyMap<string, Uint8Array>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const stack: DstarNode[] = [pkg.document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (
      node.type === "image" &&
      typeof node.attrs?.src === "string" &&
      !bytes.has(node.attrs.src)
    ) {
      diagnostics.push(
        createDiagnostic("REF_MISSING", {
          summary: "Canonical image asset is missing.",
          location: { objectId: node.id, packagePath: node.attrs.src },
        }),
      );
    }
    stack.push(...(node.children ?? []));
  }
  for (const projection of pkg.projections?.projections ?? []) {
    const artifact = bytes.get(projection.path);
    if (!artifact) {
      diagnostics.push(
        createDiagnostic("REF_MISSING", {
          summary: "Projection artifact is missing.",
          location: { objectId: projection.id, packagePath: projection.path },
        }),
      );
    } else if (projectionRevision(artifact) !== projection.revision) {
      diagnostics.push(
        createDiagnostic("REV_MISMATCH", {
          summary: "Projection raw-byte revision does not match its artifact.",
          location: { objectId: projection.id, packagePath: projection.path },
        }),
      );
    }
  }
  return diagnostics;
}

export async function openPackage(
  packageRoot: string,
  options: OpenPackageOptions = {},
): Promise<PackageSnapshot> {
  if (!isAbsolute(packageRoot)) {
    throw new PackageOpenError("Package path must be absolute", [
      createDiagnostic("PKG_PATH_INVALID", {
        summary: "Package root must be an absolute path.",
      }),
    ]);
  }
  if (!packageRoot.endsWith(".dstar")) {
    throw new PackageOpenError("Package path must end in .dstar", [
      createDiagnostic("PKG_PATH_INVALID", {
        summary: "Package root must end in .dstar.",
      }),
    ]);
  }
  const rootMetadata = await lstat(packageRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new PackageOpenError("Package root must be a regular directory", [
      createDiagnostic("PKG_PATH_INVALID", {
        summary: "Package root must be a non-link directory.",
      }),
    ]);
  }
  const root = await realpath(resolve(packageRoot));
  const limits = { ...DEFAULT_PACKAGE_LIMITS, ...options.limits };
  const { inventory, bytes } = await safeInventory(root, limits);
  const manifest = parseJson<DstarManifest>(
    requiredBytes(bytes, "manifest.json"),
    "manifest.json",
  );
  const document = parseJson<DstarDocument>(
    requiredBytes(bytes, manifest.document),
    manifest.document,
  );
  if (!inventory.some((file) => file.path.startsWith(`${manifest.changes}/`))) {
    throw new PackageOpenError(
      "Required changes directory is empty or missing",
      [
        createDiagnostic("PKG_ENTRY_MISSING", {
          summary: "The changes entrypoint is missing or empty.",
        }),
      ],
    );
  }
  const annotations = jsonObjectsIn<DstarAnnotation>(
    bytes,
    manifest.annotations ?? "annotations",
  );
  const changes = jsonObjectsIn<DstarChange>(bytes, manifest.changes);
  const sources = bytes.has(manifest.sources ?? "sources.json")
    ? parseJson<DstarSources>(
        requiredBytes(bytes, manifest.sources ?? "sources.json"),
        manifest.sources ?? "sources.json",
      )
    : undefined;
  const projections = bytes.has(
    manifest.projections ?? "projections/index.json",
  )
    ? parseJson<DstarProjectionIndex>(
        requiredBytes(bytes, manifest.projections ?? "projections/index.json"),
        manifest.projections ?? "projections/index.json",
      )
    : undefined;
  const pkg: InMemoryPackage = {
    manifest,
    document,
    annotations,
    changes,
    ...(sources ? { sources } : {}),
    ...(projections ? { projections } : {}),
  };
  const validation = validateInMemoryPackage(pkg);
  const diagnostics = [
    ...validation.diagnostics,
    ...validateNodeFileNames(pkg, bytes),
    ...validateArtifacts(pkg, bytes),
  ];
  if (
    documentRevision(document) !== manifest.revision &&
    !diagnostics.some((item) => item.code === "REV_MISMATCH")
  ) {
    diagnostics.push(
      createDiagnostic("REV_MISMATCH", {
        summary: "Manifest and document revision differ.",
      }),
    );
  }
  if (
    (options.mode ?? "strict") === "strict" &&
    diagnostics.some((item) => item.severity === "error")
  ) {
    throw new PackageOpenError(
      "Package is not semantically valid",
      diagnostics,
    );
  }
  return new PackageSnapshot({
    root,
    snapshotId: snapshotIdentifier(inventory),
    inventory,
    pkg,
    bytes,
    diagnostics,
  });
}
