import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, type CliIo } from "./cli.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-cli-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  return { temporary, packageRoot };
}

function capture(confirm = false) {
  const output: string[] = [];
  const errors: string[] = [];
  const io: CliIo = {
    write: (message) => output.push(message),
    error: (message) => errors.push(message),
    confirm: async () => confirm,
  };
  return { io, output, errors };
}

describe("dstar CLI", () => {
  it("validates and reads portable history", async () => {
    const { temporary, packageRoot } = await fixture();
    const previousRuntime = process.env.DSTAR_RUNTIME_ROOT;
    process.env.DSTAR_RUNTIME_ROOT = join(temporary, "runtime");
    try {
      const validation = capture();
      expect(await runCli(["validate", packageRoot], validation.io)).toBe(0);
      expect(JSON.parse(validation.output.join(""))).toMatchObject({
        valid: true,
        documentId: "doc_minimal",
      });

      const history = capture();
      expect(await runCli(["history", packageRoot], history.io)).toBe(0);
      expect(JSON.parse(history.output.join(""))).toEqual([
        expect.objectContaining({ changeId: "change_genesis_0001" }),
      ]);
    } finally {
      if (previousRuntime === undefined) delete process.env.DSTAR_RUNTIME_ROOT;
      else process.env.DSTAR_RUNTIME_ROOT = previousRuntime;
    }
  });

  it("has no non-interactive --yes decision path", async () => {
    const { packageRoot } = await fixture();
    await expect(
      runCli(["accept", packageRoot, "change_0001", "--yes"], capture(true).io),
    ).rejects.toThrow("--yes is not supported");
  });

  it("renders deterministic projections without changing canonical authority", async () => {
    const { temporary, packageRoot } = await fixture();
    const runtime = join(temporary, "runtime");
    const output = capture();
    expect(
      await runCli(
        ["render", packageRoot, "--runtime-root", runtime],
        output.io,
      ),
    ).toBe(0);
    const result = JSON.parse(output.output.join(""));
    expect(result.revision).toBe(
      "sha256:a59754cb50e1960f8ee58a98a90caebfc3d78e4e44429740f9c2f6cd03d100e8",
    );
    expect(result.projections).toHaveLength(3);
    expect(result.projections).toEqual(
      expect.arrayContaining([expect.objectContaining({ reviewable: true })]),
    );
  });

  it("does not mutate a decision when the human declines confirmation", async () => {
    const { temporary, packageRoot } = await fixture();
    const previousRuntime = process.env.DSTAR_RUNTIME_ROOT;
    process.env.DSTAR_RUNTIME_ROOT = join(temporary, "runtime");
    try {
      expect(
        await runCli(["accept", packageRoot, "change_0001"], capture(false).io),
      ).toBe(2);
      const validation = capture();
      await runCli(["validate", packageRoot], validation.io);
      expect(JSON.parse(validation.output.join("")).revision).toBe(
        "sha256:a59754cb50e1960f8ee58a98a90caebfc3d78e4e44429740f9c2f6cd03d100e8",
      );
    } finally {
      if (previousRuntime === undefined) delete process.env.DSTAR_RUNTIME_ROOT;
      else process.env.DSTAR_RUNTIME_ROOT = previousRuntime;
    }
  });
});
