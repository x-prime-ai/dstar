import { CORE_SDK_STABILITY, createDiagnostic, SCHEMA_IDS } from "@dstar/core";
import { describeNodeRuntimeBoundary } from "@dstar/node";
import { loadMinimalFixture } from "@dstar/node/testing";

export async function consumeDocumentFixture(repositoryRoot: string) {
  const fixture = await loadMinimalFixture(repositoryRoot);
  return {
    coreStability: CORE_SDK_STABILITY,
    schemaId: SCHEMA_IDS.document,
    boundary: describeNodeRuntimeBoundary(),
    manifest: fixture.readJson("manifest.json"),
    exampleDiagnostic: createDiagnostic("SCHEMA_VALIDATION_FAILED"),
  };
}
