import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DocumentIndex,
  acceptUpdateChange,
  buildUpdateProposal,
  documentRevision,
  materializeVersion,
  nodeRevision,
  resolveCanonicalTarget,
  simulateOperations,
  validateInMemoryPackage,
  validateStructure,
} from "../packages/core/dist/index.js";
import { PackageRepository } from "../packages/node/dist/index.js";
import {
  renderCanonicalHtml,
  renderProjection,
} from "../packages/render-html/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureIndexPath = resolve(root, "spec/0.1/tests/roles/manifest.json");
const fixtureDirectory = dirname(fixtureIndexPath);
const index = JSON.parse(await readFile(fixtureIndexPath, "utf8"));
if (index.format !== "dstar-role-fixtures/0.1") {
  throw new Error("Unsupported role fixture format");
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runCase(entry) {
  const packageRoot = resolve(fixtureDirectory, entry.package);
  const repository = new PackageRepository(
    resolve(root, ".runtime/conformance-role-runner"),
  );
  const snapshot = await repository.open(packageRoot, { mode: "read-only" });
  const packageValidation = validateInMemoryPackage(snapshot);
  const history = materializeVersion(snapshot, snapshot.manifest.headChange);
  const nodeIndex = new DocumentIndex(snapshot.document);
  const target = snapshot.annotations[0]?.canonicalTargets?.[0];
  if (!target)
    throw new Error("Fixture must contain a canonical review target");
  const targetResolution = resolveCanonicalTarget(snapshot.document, {
    source: target.source,
    revision: target.revision,
    selector: target.selector,
  });
  const promise = nodeIndex.get("node_promise");
  if (!promise) throw new Error("Fixture must contain node_promise");
  const operation = {
    id: "op_conformance_replace",
    op: "replace_text",
    target: { node: promise.id },
    precondition: {
      nodeRevision: nodeRevision(promise),
      expectedText: "direct",
    },
    range: { start: 22, end: 28, unit: "unicode-code-point" },
    value: "guide",
  };
  const writeSimulation = simulateOperations(
    snapshot.document,
    [operation],
    snapshot.manifest.profiles,
  );
  if (!writeSimulation.result || !writeSimulation.resultRevision) {
    throw new Error("Conformance update was not applicable");
  }
  const proposal = buildUpdateProposal({
    id: "change_conformance_update",
    idempotencyKey: "conformance-update",
    author: { type: "agent", id: "agent_conformance" },
    baseChange: snapshot.manifest.headChange,
    baseRevision: snapshot.manifest.revision,
    operations: [operation],
    createdAt: "2026-08-26T00:00:00Z",
    motivatedBy: [snapshot.annotations[0].id],
  });
  const proposalValidation = validateStructure("change", proposal);
  const packageWithProposal = {
    manifest: snapshot.manifest,
    document: snapshot.document,
    annotations: snapshot.annotations,
    delegations: snapshot.delegations,
    changes: [...snapshot.changes, proposal],
    ...(snapshot.sources ? { sources: snapshot.sources } : {}),
    ...(snapshot.projections ? { projections: snapshot.projections } : {}),
  };
  const accepted = acceptUpdateChange(
    packageWithProposal,
    proposal.id,
    { type: "human", id: "human_conformance" },
    "2026-08-26T00:01:00Z",
    writeSimulation.resultRevision,
  );
  const canonical = renderCanonicalHtml(snapshot);
  const projections = ["html", "markdown", "plain-text"].map((kind) => {
    const rendered = renderProjection(snapshot, kind);
    return {
      kind,
      revision: rendered.revision,
      reviewable: rendered.reviewable,
      segmentCount: rendered.segments.length,
    };
  });

  return {
    format: "dstar-role-output/0.1",
    caseId: entry.id,
    dstar: snapshot.manifest.dstar,
    profiles: snapshot.manifest.profiles,
    roles: {
      "Core Reader": {
        valid: packageValidation.valid,
        documentId: snapshot.manifest.id,
        documentRevision: documentRevision(snapshot.document),
        nodeCount: nodeIndex.readingOrder.length,
      },
      "Version Reader": {
        valid: history.valid,
        targetChangeId: history.targetChangeId,
        revision: history.revision,
        versionCount: history.versions.length,
      },
      "Core Writer": {
        applicable: writeSimulation.applicable,
        resultRevision: writeSimulation.resultRevision,
        preservedRootId: writeSimulation.result.id,
      },
      "Review Client": {
        annotationId: snapshot.annotations[0].id,
        targetState: targetResolution.state,
      },
      "Change Producer": {
        valid: proposalValidation.valid,
        authorType: proposal.author.type,
        status: proposal.status,
        operationCount: proposal.operations.length,
      },
      "Change Applier": {
        valid: accepted.valid,
        decisionActorType:
          accepted.package?.changes.at(-1)?.decision?.actor.type,
        resultRevision: accepted.package?.manifest.revision,
      },
      "Projection Renderer": {
        canonicalByteLength: canonical.bytes.byteLength,
        canonicalNodeOrder: canonical.nodeOrder,
        projections,
      },
    },
  };
}

let failed = false;
for (const entry of index.cases) {
  const actual = await runCase(entry);
  if (process.argv.includes("--emit")) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    continue;
  }
  const expected = JSON.parse(
    await readFile(resolve(fixtureDirectory, entry.expected), "utf8"),
  );
  if (!equalJson(actual, expected)) {
    failed = true;
    process.stderr.write(
      `Role fixture ${entry.id} did not match reference output.\n`,
    );
    process.stderr.write(`${JSON.stringify(actual, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Role fixture ${entry.id}: ${entry.roles.length} roles passed.\n`,
    );
  }
}
if (failed) process.exitCode = 1;
