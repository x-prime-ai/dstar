import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { revisionOf } from "../packages/core/dist/index.js";
import { PackageRepository } from "../packages/node/dist/index.js";

const temporary = await mkdtemp(join(tmpdir(), "dstar-portable-reopen-"));
const packageRoot = join(temporary, "portable.dstar");
const runtimeRoot = join(temporary, "runtime");
try {
  await cp(resolve("spec/0.1/examples/minimal.dstar"), packageRoot, {
    recursive: true,
  });
  const first = await new PackageRepository(runtimeRoot).open(packageRoot);
  const portableShape = (snapshot) => ({
    manifest: snapshot.manifest,
    document: snapshot.document,
    annotations: snapshot.annotations,
    delegations: snapshot.delegations,
    changes: snapshot.changes,
    sources: snapshot.sources ?? null,
    projections: snapshot.projections ?? null,
  });
  const before = revisionOf(portableShape(first));
  await rm(runtimeRoot, { recursive: true, force: true });
  const second = await new PackageRepository(runtimeRoot).open(packageRoot);
  const after = revisionOf(portableShape(second));
  if (
    before !== after ||
    second.diagnostics.some((item) => item.severity === "error")
  ) {
    throw new Error(
      "Portable package did not survive deletion of runtime state",
    );
  }
  process.stdout.write(
    `Portable reopen: ${second.annotations.length} annotations, ` +
      `${second.delegations.length} delegations, ${second.changes.length} changes passed.\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
