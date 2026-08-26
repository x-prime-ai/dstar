import { cp, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { openPackage, type PackageOpenError } from "./package.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);

async function copyFixture(): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-package-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  return packageRoot;
}

describe("safe package opening", () => {
  it("opens minimal.dstar as a validated immutable snapshot", async () => {
    const snapshot = await openPackage(fixtureRoot);
    expect(snapshot.writable).toBe(true);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.snapshotId).toMatch(/^snapshot:[0-9a-f]{64}$/);
    expect(snapshot.readFile("document.json")).toBeInstanceOf(Uint8Array);
  });

  it("rejects package-local links before reading their targets", async () => {
    const packageRoot = await copyFixture();
    await symlink("document.json", join(packageRoot, "assets", "linked.json"));
    await expect(
      openPackage(packageRoot),
    ).rejects.toMatchObject<PackageOpenError>({
      diagnostics: [expect.objectContaining({ code: "PKG_PATH_INVALID" })],
    });
  });

  it("rejects duplicate JSON object keys", async () => {
    const packageRoot = await copyFixture();
    await writeFile(
      join(packageRoot, "manifest.json"),
      '{"dstar":"0.1","dstar":"0.1"}',
      "utf8",
    );
    await expect(
      openPackage(packageRoot),
    ).rejects.toMatchObject<PackageOpenError>({
      diagnostics: [expect.objectContaining({ code: "JSON_PARSE_FAILED" })],
    });
  });
});
