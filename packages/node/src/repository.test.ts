import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PackageRepository,
  encodeJson,
  type PackageTransactionError,
} from "./repository.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);

async function workspace() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-repository-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  const repository = new PackageRepository(join(temporary, "runtime"));
  return { packageRoot, repository };
}

describe("recoverable package repository", () => {
  it("commits validated object replacement and handles idempotent retry", async () => {
    const { packageRoot, repository } = await workspace();
    const snapshot = await repository.open(packageRoot);
    const annotation = {
      ...snapshot.annotations[0]!,
      body: "Updated review body",
    };
    const mutation = {
      expectedSnapshotId: snapshot.snapshotId,
      transactionType: "annotation" as const,
      writes: new Map([
        [`annotations/${annotation.id}.json`, encodeJson(annotation)],
      ]),
      idempotency: {
        key: "annotation-command-1",
        arguments: { annotationId: annotation.id, body: annotation.body },
      },
    };
    const committed = await repository.commit(snapshot, mutation);
    expect(committed.annotations[0]?.body).toBe("Updated review body");

    const repeated = await repository.commit(snapshot, mutation);
    expect(repeated.snapshotId).toBe(committed.snapshotId);

    await expect(
      repository.commit(snapshot, {
        ...mutation,
        idempotency: {
          key: "annotation-command-1",
          arguments: { annotationId: annotation.id, body: "Different" },
        },
      }),
    ).rejects.toMatchObject<PackageTransactionError>({
      diagnostics: [
        expect.objectContaining({ code: "COMMAND_IDEMPOTENCY_MISMATCH" }),
      ],
    });
  });

  it("recovers an injected partial multi-file install to a valid old snapshot", async () => {
    const { packageRoot, repository } = await workspace();
    const snapshot = await repository.open(packageRoot);
    const annotation = {
      ...snapshot.annotations[0]!,
      body: "Partially installed",
    };
    const delegation = {
      ...snapshot.delegations[0]!,
      instruction: "Partially installed",
    };
    await expect(
      repository.commit(
        snapshot,
        {
          expectedSnapshotId: snapshot.snapshotId,
          transactionType: "proposal",
          writes: new Map([
            [`annotations/${annotation.id}.json`, encodeJson(annotation)],
            [`delegations/${delegation.id}.json`, encodeJson(delegation)],
          ]),
        },
        { failAfterInstallStep: 1 },
      ),
    ).rejects.toThrowError("Injected transaction failure");

    const recovered = await repository.open(packageRoot);
    expect(recovered.snapshotId).toBe(snapshot.snapshotId);
    expect(recovered.annotations[0]?.body).toBe(snapshot.annotations[0]?.body);
    expect(recovered.delegations[0]?.instruction).toBe(
      snapshot.delegations[0]?.instruction,
    );
  });

  it("rejects stale snapshots before writing", async () => {
    const { packageRoot, repository } = await workspace();
    const snapshot = await repository.open(packageRoot);
    const annotation = { ...snapshot.annotations[0]!, body: "First" };
    await repository.commit(snapshot, {
      expectedSnapshotId: snapshot.snapshotId,
      transactionType: "annotation",
      writes: new Map([
        [`annotations/${annotation.id}.json`, encodeJson(annotation)],
      ]),
    });
    await expect(
      repository.commit(snapshot, {
        expectedSnapshotId: snapshot.snapshotId,
        transactionType: "annotation",
        writes: new Map([
          [
            `annotations/${annotation.id}.json`,
            encodeJson({ ...annotation, body: "Second" }),
          ],
        ]),
      }),
    ).rejects.toMatchObject<PackageTransactionError>({
      diagnostics: [expect.objectContaining({ code: "TXN_SNAPSHOT_STALE" })],
    });
  });

  it("allows projection registration without granting manifest authority", async () => {
    const { packageRoot, repository } = await workspace();
    const snapshot = await repository.open(packageRoot);
    await expect(
      repository.commit(snapshot, {
        expectedSnapshotId: snapshot.snapshotId,
        transactionType: "projection",
        writes: new Map([
          [
            "manifest.json",
            encodeJson({ ...snapshot.manifest, title: "Unauthorized title" }),
          ],
        ]),
      }),
    ).rejects.toMatchObject<PackageTransactionError>({
      diagnostics: [expect.objectContaining({ code: "PKG_PATH_INVALID" })],
    });
  });

  it("finishes an all-new journal and restores its idempotent result after restart", async () => {
    const { packageRoot, repository } = await workspace();
    const snapshot = await repository.open(packageRoot);
    const annotation = {
      ...snapshot.annotations[0]!,
      body: "Installed before ledger write",
    };
    const mutation = {
      expectedSnapshotId: snapshot.snapshotId,
      transactionType: "annotation" as const,
      writes: new Map([
        [`annotations/${annotation.id}.json`, encodeJson(annotation)],
      ]),
      idempotency: {
        key: "recover-idempotency",
        arguments: { annotationId: annotation.id, body: annotation.body },
      },
    };
    await expect(
      repository.commit(snapshot, mutation, { failAfterInstallStep: 1 }),
    ).rejects.toThrowError("Injected transaction failure");

    const repeated = await repository.commit(snapshot, mutation);
    const recovered = await repository.open(packageRoot);
    expect(recovered.annotations[0]?.body).toBe(annotation.body);
    expect(repeated.snapshotId).toBe(recovered.snapshotId);
  });
});
