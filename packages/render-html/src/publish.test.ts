import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PackageRepository } from "@dstar/node";
import { publishProjections } from "./publish.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);

describe("projection publication", () => {
  it("retains referenced artifacts, commits atomically, and is stable on retry", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "dstar-render-test-"));
    const packageRoot = join(temporary, "fixture.dstar");
    await cp(fixtureRoot, packageRoot, { recursive: true });
    const repository = new PackageRepository(join(temporary, "runtime"));
    const opened = await repository.open(packageRoot);
    const originalHtml = await readFile(
      join(packageRoot, "projections/document.html"),
    );

    const first = await publishProjections(repository, opened);
    expect(first.snapshot.manifest.revision).toBe(opened.manifest.revision);
    expect(first.projections).toHaveLength(3);
    const html = first.projections.find(
      (projection) => projection.mediaType === "text/html",
    )!;
    expect(html.id).not.toBe("projection_html");
    expect(
      first.snapshot.projections?.projections.some(
        (projection) => projection.id === "projection_html",
      ),
    ).toBe(true);
    expect(
      await readFile(join(packageRoot, "projections/document.html")),
    ).toEqual(originalHtml);

    const firstIndex = await readFile(
      join(packageRoot, "projections/index.json"),
    );
    const second = await publishProjections(repository, first.snapshot);
    const secondIndex = await readFile(
      join(packageRoot, "projections/index.json"),
    );
    expect(secondIndex).toEqual(firstIndex);
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
  });
});
