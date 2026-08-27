import {
  createDiagnostic,
  parseIJson,
  revisionOf,
  sha256Hex,
  validatePackagePath,
  type Diagnostic,
  type DstarManifest,
  type JsonValue,
} from "@dstar/core";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import {
  openPackage,
  type OpenPackageOptions,
  type PackageSnapshot,
} from "./package.js";

export type TransactionType =
  | "genesis"
  | "annotation"
  | "evidence"
  | "proposal"
  | "decision"
  | "accept-change"
  | "projection";

export interface IdempotencyCommand {
  readonly key: string;
  readonly arguments: JsonValue;
}

export interface PackageMutation {
  readonly expectedSnapshotId: string;
  readonly transactionType: TransactionType;
  readonly writes: ReadonlyMap<string, Uint8Array>;
  readonly deletes?: ReadonlySet<string>;
  readonly expectedCurrentHashes?: ReadonlyMap<string, string | "absent">;
  readonly idempotency?: IdempotencyCommand;
}

export interface CommitOptions {
  /** Test-only crash injection after this many installed targets. */
  readonly failAfterInstallStep?: number;
}

interface JournalEntry {
  readonly path: string;
  readonly oldHash: string | "absent";
  readonly newHash: string | "absent";
}

interface TransactionJournal {
  readonly id: string;
  readonly packageRoot: string;
  readonly runtimeKey: string;
  readonly transactionType: TransactionType;
  readonly entries: readonly JournalEntry[];
  readonly idempotency?: Omit<IdempotencyRecord, "resultSnapshotId">;
  state: "prepared" | "installing" | "committed" | "rolled-back";
  resultSnapshotId?: string;
}

interface IdempotencyRecord {
  readonly key: string;
  readonly commandDigest: string;
  readonly resultSnapshotId: string;
}

interface LockRecord {
  readonly transactionId: string;
  readonly pid: number;
  readonly createdAt: string;
}

export class PackageTransactionError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[]) {
    super(message);
    this.name = "PackageTransactionError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

export function encodeJson(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function fileHash(path: string): Promise<string | "absent"> {
  try {
    return sha256Hex(new Uint8Array(await readFile(path)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

async function writeJsonFile(path: string, value: JsonValue): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encodeJson(value));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isWithin(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`);
}

function legalForTransaction(
  type: TransactionType,
  path: string,
  snapshot: PackageSnapshot,
): boolean {
  if (!validatePackagePath(path).valid) return false;
  const annotationDirectory = snapshot.manifest.annotations ?? "annotations";
  const changeDirectory = snapshot.manifest.changes;
  const sourcesPath = snapshot.manifest.sources ?? "sources.json";
  const assetsDirectory = snapshot.manifest.assets ?? "assets";
  const projectionsPath =
    snapshot.manifest.projections ?? "projections/index.json";
  switch (type) {
    case "annotation":
      return isWithin(path, annotationDirectory);
    case "evidence":
      return (
        path === sourcesPath || isWithin(path, `${assetsDirectory}/sources`)
      );
    case "proposal":
      return (
        isWithin(path, changeDirectory) || isWithin(path, annotationDirectory)
      );
    case "decision":
      return isWithin(path, changeDirectory);
    case "accept-change":
      return (
        path === snapshot.manifest.document ||
        path === "manifest.json" ||
        isWithin(path, changeDirectory)
      );
    case "projection":
      return (
        path === "manifest.json" ||
        path === projectionsPath ||
        isWithin(path, dirname(projectionsPath)) ||
        snapshot.projections?.projections.some(
          (projection) => projection.path === path,
        ) === true
      );
    case "genesis":
      return true;
  }
}

function commandDigest(command: IdempotencyCommand): string {
  return revisionOf({ key: command.key, arguments: command.arguments });
}

async function copySnapshot(
  snapshot: PackageSnapshot,
  targetRoot: string,
): Promise<void> {
  await mkdir(targetRoot, { recursive: true });
  for (const entry of snapshot.inventory) {
    const bytes = snapshot.readFile(entry.path);
    if (!bytes) throw new Error(`Snapshot bytes missing for ${entry.path}`);
    const target = join(targetRoot, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

export class PackageRepository {
  readonly runtimeRoot: string;

  constructor(runtimeRoot: string) {
    this.runtimeRoot = resolve(runtimeRoot);
  }

  async open(
    path: string,
    options: OpenPackageOptions = {},
  ): Promise<PackageSnapshot> {
    await this.recover(path);
    return openPackage(path, options);
  }

  async #runtimeKey(snapshot: PackageSnapshot): Promise<string> {
    return sha256Hex(
      new TextEncoder().encode(`${snapshot.root}\u0000${snapshot.manifest.id}`),
    );
  }

  #runtimeDirectory(runtimeKey: string): string {
    return join(this.runtimeRoot, "packages", runtimeKey);
  }

  async #acquireLock(
    runtimeDirectory: string,
    transactionId: string,
  ): Promise<() => Promise<void>> {
    await mkdir(runtimeDirectory, { recursive: true });
    const lockPath = join(runtimeDirectory, "lock.json");
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as LockRecord;
        if (processIsAlive(lock.pid)) {
          throw new PackageTransactionError("Package is locked", [
            createDiagnostic("TXN_LOCKED"),
          ]);
        }
        await unlink(lockPath);
        handle = await open(lockPath, "wx", 0o600);
      } else {
        throw error;
      }
    }
    await handle.writeFile(
      encodeJson({
        transactionId,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );
    return async () => {
      await handle.close();
      await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    };
  }

  async #readIdempotency(
    runtimeDirectory: string,
  ): Promise<readonly IdempotencyRecord[]> {
    const path = join(runtimeDirectory, "idempotency.json");
    try {
      return JSON.parse(await readFile(path, "utf8")) as IdempotencyRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #recordIdempotency(
    runtimeDirectory: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    const records = await this.#readIdempotency(runtimeDirectory);
    const existing = records.find((candidate) => candidate.key === record.key);
    if (existing) {
      if (
        existing.commandDigest !== record.commandDigest ||
        existing.resultSnapshotId !== record.resultSnapshotId
      ) {
        throw new PackageTransactionError("Idempotency record mismatch", [
          createDiagnostic("COMMAND_IDEMPOTENCY_MISMATCH"),
        ]);
      }
      return;
    }
    const path = join(runtimeDirectory, "idempotency.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeJsonFile(temporary, [
      ...records,
      record,
    ] as unknown as JsonValue);
    await rename(temporary, path);
  }

  async commit(
    snapshot: PackageSnapshot,
    mutation: PackageMutation,
    options: CommitOptions = {},
  ): Promise<PackageSnapshot> {
    if (!snapshot.writable) {
      throw new PackageTransactionError(
        "Read-only invalid snapshot",
        snapshot.diagnostics,
      );
    }
    await this.recover(snapshot.root);
    const runtimeKey = await this.#runtimeKey(snapshot);
    const runtimeDirectory = this.#runtimeDirectory(runtimeKey);
    const existingIdempotency = mutation.idempotency
      ? (await this.#readIdempotency(runtimeDirectory)).find(
          (record) => record.key === mutation.idempotency?.key,
        )
      : undefined;
    if (existingIdempotency && mutation.idempotency) {
      if (
        existingIdempotency.commandDigest !==
        commandDigest(mutation.idempotency)
      ) {
        throw new PackageTransactionError("Idempotency key mismatch", [
          createDiagnostic("COMMAND_IDEMPOTENCY_MISMATCH"),
        ]);
      }
      const current = await this.open(snapshot.root);
      if (current.snapshotId !== existingIdempotency.resultSnapshotId) {
        throw new PackageTransactionError(
          "Idempotent result is no longer current",
          [
            createDiagnostic("TXN_SNAPSHOT_STALE", {
              summary:
                "The prior idempotent result exists, but the package has advanced since it completed.",
            }),
          ],
        );
      }
      return current;
    }

    const transactionId = randomUUID();
    const releaseLock = await this.#acquireLock(
      runtimeDirectory,
      transactionId,
    );
    try {
      const current = await openPackage(snapshot.root);
      if (
        mutation.expectedSnapshotId !== snapshot.snapshotId ||
        current.snapshotId !== mutation.expectedSnapshotId
      ) {
        throw new PackageTransactionError("Snapshot is stale", [
          createDiagnostic("TXN_SNAPSHOT_STALE"),
        ]);
      }
      const targets = new Set([
        ...mutation.writes.keys(),
        ...(mutation.deletes ?? []),
      ]);
      if (
        mutation.transactionType === "projection" &&
        targets.has("manifest.json")
      ) {
        const manifestBytes = mutation.writes.get("manifest.json");
        let proposedManifest: DstarManifest | undefined;
        try {
          proposedManifest = manifestBytes
            ? (parseIJson(manifestBytes).value as unknown as DstarManifest)
            : undefined;
        } catch {
          proposedManifest = undefined;
        }
        const permittedManifest = {
          ...current.manifest,
          projections: "projections/index.json",
        };
        if (
          !proposedManifest ||
          revisionOf(proposedManifest as unknown as JsonValue) !==
            revisionOf(permittedManifest as unknown as JsonValue)
        ) {
          throw new PackageTransactionError(
            "Projection transaction cannot modify manifest authority fields",
            [
              createDiagnostic("PKG_PATH_INVALID", {
                summary:
                  "A projection transaction may only add the projections/index.json manifest entrypoint.",
                location: { packagePath: "manifest.json" },
              }),
            ],
          );
        }
      }
      for (const path of targets) {
        if (!legalForTransaction(mutation.transactionType, path, current)) {
          throw new PackageTransactionError("Illegal mutation path", [
            createDiagnostic("PKG_PATH_INVALID", {
              summary: `${mutation.transactionType} transaction cannot modify ${path}.`,
              location: { packagePath: path },
            }),
          ]);
        }
        const expected = mutation.expectedCurrentHashes?.get(path);
        if (expected !== undefined) {
          const actual =
            current.inventory.find((entry) => entry.path === path)?.sha256 ??
            "absent";
          if (actual !== expected) {
            throw new PackageTransactionError(
              "Expected file hash does not match",
              [
                createDiagnostic("TXN_SNAPSHOT_STALE", {
                  location: { packagePath: path },
                }),
              ],
            );
          }
        }
      }

      const transactionDirectory = join(
        runtimeDirectory,
        "transactions",
        transactionId,
      );
      const candidateRoot = join(transactionDirectory, "candidate.dstar");
      const stagedRoot = join(transactionDirectory, "staged");
      const backupsRoot = join(transactionDirectory, "backups");
      await copySnapshot(current, candidateRoot);
      for (const [path, bytes] of mutation.writes) {
        const candidatePath = join(candidateRoot, path);
        await mkdir(dirname(candidatePath), { recursive: true });
        await writeFile(candidatePath, bytes);
        const stagedPath = join(stagedRoot, path);
        await mkdir(dirname(stagedPath), { recursive: true });
        await writeFile(stagedPath, bytes);
      }
      for (const path of mutation.deletes ?? [])
        await rm(join(candidateRoot, path), { force: true });
      await openPackage(candidateRoot);

      const entries: JournalEntry[] = [];
      for (const path of [...targets].sort()) {
        const oldHash =
          current.inventory.find((entry) => entry.path === path)?.sha256 ??
          "absent";
        const newBytes = mutation.writes.get(path);
        entries.push({
          path,
          oldHash,
          newHash: newBytes ? sha256Hex(newBytes) : "absent",
        });
      }
      const journal: TransactionJournal = {
        id: transactionId,
        packageRoot: current.root,
        runtimeKey,
        transactionType: mutation.transactionType,
        entries,
        ...(mutation.idempotency
          ? {
              idempotency: {
                key: mutation.idempotency.key,
                commandDigest: commandDigest(mutation.idempotency),
              },
            }
          : {}),
        state: "prepared",
      };
      const journalPath = join(transactionDirectory, "journal.json");
      await writeJsonFile(journalPath, journal as unknown as JsonValue);
      journal.state = "installing";
      await writeJsonFile(journalPath, journal as unknown as JsonValue);

      const installOrder = [...entries].sort((left, right) => {
        if (left.path === "manifest.json") return 1;
        if (right.path === "manifest.json") return -1;
        return left.path.localeCompare(right.path);
      });
      let installStep = 0;
      for (const entry of installOrder) {
        const target = join(current.root, entry.path);
        const backup = join(backupsRoot, entry.path);
        if (await exists(target)) {
          await mkdir(dirname(backup), { recursive: true });
          await rename(target, backup);
        }
        if (entry.newHash !== "absent") {
          await mkdir(dirname(target), { recursive: true });
          await rename(join(stagedRoot, entry.path), target);
        }
        installStep += 1;
        if (options.failAfterInstallStep === installStep) {
          throw new Error(
            `Injected transaction failure after install step ${installStep}`,
          );
        }
      }

      const result = await openPackage(current.root);
      journal.state = "committed";
      journal.resultSnapshotId = result.snapshotId;
      await writeJsonFile(journalPath, journal as unknown as JsonValue);
      if (mutation.idempotency) {
        await this.#recordIdempotency(runtimeDirectory, {
          key: mutation.idempotency.key,
          commandDigest: commandDigest(mutation.idempotency),
          resultSnapshotId: result.snapshotId,
        });
      }
      return result;
    } finally {
      await releaseLock();
    }
  }

  async recover(packageRoot: string): Promise<void> {
    const canonicalPackageRoot = await realpath(resolve(packageRoot));
    const packagesRoot = join(this.runtimeRoot, "packages");
    if (!(await exists(packagesRoot))) return;
    for (const runtimeKey of await readdir(packagesRoot)) {
      const runtimeDirectory = join(packagesRoot, runtimeKey);
      const transactionsRoot = join(runtimeDirectory, "transactions");
      if (!(await exists(transactionsRoot))) continue;
      let lockChecked = false;
      for (const transactionId of await readdir(transactionsRoot)) {
        const transactionDirectory = join(transactionsRoot, transactionId);
        const journalPath = join(transactionDirectory, "journal.json");
        if (!(await exists(journalPath))) continue;
        const journal = JSON.parse(
          await readFile(journalPath, "utf8"),
        ) as TransactionJournal;
        if (
          (await realpath(resolve(journal.packageRoot))) !==
          canonicalPackageRoot
        )
          continue;
        if (journal.state === "committed" || journal.state === "rolled-back")
          continue;
        if (!lockChecked) {
          const lockPath = join(runtimeDirectory, "lock.json");
          if (await exists(lockPath)) {
            const lock = JSON.parse(
              await readFile(lockPath, "utf8"),
            ) as LockRecord;
            if (processIsAlive(lock.pid)) {
              throw new PackageTransactionError("Package is locked", [
                createDiagnostic("TXN_LOCKED"),
              ]);
            }
            await unlink(lockPath);
          }
          lockChecked = true;
        }
        const states = await Promise.all(
          journal.entries.map(async (entry) => ({
            entry,
            actual: await fileHash(join(journal.packageRoot, entry.path)),
          })),
        );
        if (states.every(({ entry, actual }) => actual === entry.newHash)) {
          const result = await openPackage(journal.packageRoot);
          journal.state = "committed";
          journal.resultSnapshotId = result.snapshotId;
          await writeJsonFile(journalPath, journal as unknown as JsonValue);
          if (journal.idempotency) {
            await this.#recordIdempotency(runtimeDirectory, {
              ...journal.idempotency,
              resultSnapshotId: result.snapshotId,
            });
          }
          continue;
        }
        if (!states.every(({ entry, actual }) => actual === entry.oldHash)) {
          try {
            for (const { entry, actual } of states) {
              if (actual === entry.oldHash) continue;
              const target = join(journal.packageRoot, entry.path);
              const backup = join(transactionDirectory, "backups", entry.path);
              await rm(target, { force: true });
              if (entry.oldHash !== "absent") {
                if (!(await exists(backup)))
                  throw new Error(`Missing backup for ${entry.path}`);
                await mkdir(dirname(target), { recursive: true });
                await rename(backup, target);
              }
            }
            for (const { entry } of states) {
              const restored = await fileHash(
                join(journal.packageRoot, entry.path),
              );
              if (restored !== entry.oldHash) {
                throw new Error(`Restored hash mismatch for ${entry.path}`);
              }
            }
            await openPackage(journal.packageRoot);
          } catch (error) {
            throw new PackageTransactionError(
              "Transaction recovery requires manual intervention",
              [
                createDiagnostic("TXN_RECOVERY_REQUIRED", {
                  summary:
                    error instanceof Error
                      ? error.message
                      : "Transaction rollback failed.",
                }),
              ],
            );
          }
        }
        journal.state = "rolled-back";
        await writeJsonFile(journalPath, journal as unknown as JsonValue);
      }
    }
  }
}
