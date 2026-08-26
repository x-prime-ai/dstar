import {
  CORE_SDK_STABILITY,
  createDiagnostic,
  documentRevision,
  parseIJson,
  SCHEMA_IDS,
  validateStructure,
} from "@dstar/core";
import { describeNodeRuntimeBoundary } from "@dstar/node";
import { loadMinimalFixture } from "@dstar/node/testing";
import { RENDERER_VERSION } from "@dstar/render-html";
import type { Diagnostic } from "@dstar/core";
import type { NodeRuntimeBoundary } from "@dstar/node";

export interface ConsumerResult {
  readonly coreStability: "experimental";
  readonly schemaId: string;
  readonly boundary: NodeRuntimeBoundary;
  readonly rendererVersion: "0.1.0";
  readonly manifest: unknown;
  readonly documentValidation: {
    readonly valid: boolean;
    readonly diagnostics: readonly Diagnostic[];
  };
  readonly documentRevision?: string;
  readonly exampleDiagnostic: Diagnostic;
}

export async function consumeDocumentFixture(
  repositoryRoot: string,
): Promise<ConsumerResult> {
  const fixture = await loadMinimalFixture(repositoryRoot);
  const document = parseIJson(
    fixture.files.find((file) => file.path === "document.json")!.bytes,
  ).value;
  const documentValidation = validateStructure("document", document);
  return {
    coreStability: CORE_SDK_STABILITY,
    schemaId: SCHEMA_IDS.document,
    boundary: describeNodeRuntimeBoundary(),
    rendererVersion: RENDERER_VERSION,
    manifest: fixture.readJson("manifest.json"),
    documentValidation,
    ...(documentValidation.value
      ? { documentRevision: documentRevision(documentValidation.value) }
      : {}),
    exampleDiagnostic: createDiagnostic("SCHEMA_VALIDATION_FAILED"),
  };
}
