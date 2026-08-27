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
  revisionOf,
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
  return revisionOf(left) === revisionOf(right);
}

const supportedRoles = new Set([
  "Core Reader",
  "Version Reader",
  "Core Writer",
  "Review Client",
  "Change Producer",
  "Change Applier",
  "Projection Renderer",
]);

function requireExercise(entry, name) {
  const exercise = entry.exercise?.[name];
  if (!exercise || typeof exercise !== "object") {
    throw new Error(`Fixture ${entry.id} requires exercise.${name}`);
  }
  return exercise;
}

async function runCase(entry) {
  if (
    !Array.isArray(entry.roles) ||
    entry.roles.some((role) => !supportedRoles.has(role))
  ) {
    throw new Error(`Fixture ${entry.id} declares an unsupported role`);
  }
  const packageRoot = resolve(fixtureDirectory, entry.package);
  const repository = new PackageRepository(
    resolve(root, ".runtime/conformance-role-runner"),
  );
  const snapshot = await repository.open(packageRoot, { mode: "read-only" });
  if (!equalJson(snapshot.manifest.profiles, entry.profiles)) {
    throw new Error(`Fixture ${entry.id} profile declaration does not match`);
  }
  const packageValidation = validateInMemoryPackage(snapshot);
  const history = materializeVersion(snapshot, snapshot.manifest.headChange);
  const nodeIndex = new DocumentIndex(snapshot.document);
  const requestedRoles = new Set(entry.roles);
  const roles = {};

  let reviewAnnotation;
  let targetResolution;
  if (requestedRoles.has("Review Client")) {
    const review = requireExercise(entry, "review");
    reviewAnnotation = snapshot.annotations.find(
      (annotation) => annotation.id === review.annotationId,
    );
    const target =
      reviewAnnotation?.canonicalTargets?.[review.canonicalTargetIndex ?? 0];
    if (!target) {
      throw new Error(`Fixture ${entry.id} lacks its canonical review target`);
    }
    targetResolution = resolveCanonicalTarget(snapshot.document, {
      source: target.source,
      revision: target.revision,
      selector: target.selector,
    });
  }

  let writeSimulation;
  let proposal;
  let proposalValidation;
  let accepted;
  if (
    requestedRoles.has("Core Writer") ||
    requestedRoles.has("Change Producer") ||
    requestedRoles.has("Change Applier")
  ) {
    const update = requireExercise(entry, "update");
    const { expectedText, ...operationTemplate } = update.operation;
    const targetNode = nodeIndex.get(operationTemplate.target?.node);
    if (!targetNode) {
      throw new Error(`Fixture ${entry.id} update target does not exist`);
    }
    const operation = {
      ...operationTemplate,
      precondition: {
        nodeRevision: nodeRevision(targetNode),
        ...(expectedText === undefined ? {} : { expectedText }),
      },
    };
    writeSimulation = simulateOperations(
      snapshot.document,
      [operation],
      snapshot.manifest.profiles,
    );
    if (!writeSimulation.result || !writeSimulation.resultRevision) {
      throw new Error(`Fixture ${entry.id} update was not applicable`);
    }
    proposal = buildUpdateProposal({
      id: update.proposal.id,
      idempotencyKey: update.proposal.idempotencyKey,
      author: update.proposal.author,
      baseChange: snapshot.manifest.headChange,
      baseRevision: snapshot.manifest.revision,
      operations: [operation],
      createdAt: update.proposal.createdAt,
      motivatedBy: update.proposal.motivatedBy,
    });
    proposalValidation = validateStructure("change", proposal);
    const packageWithProposal = {
      manifest: snapshot.manifest,
      document: snapshot.document,
      annotations: snapshot.annotations,
      changes: [...snapshot.changes, proposal],
      ...(snapshot.sources ? { sources: snapshot.sources } : {}),
      ...(snapshot.projections ? { projections: snapshot.projections } : {}),
    };
    accepted = acceptUpdateChange(
      packageWithProposal,
      proposal.id,
      update.decision.actor,
      update.decision.decidedAt,
      writeSimulation.resultRevision,
    );
  }

  if (requestedRoles.has("Core Reader")) {
    roles["Core Reader"] = {
      valid: packageValidation.valid,
      documentId: snapshot.manifest.id,
      documentRevision: documentRevision(snapshot.document),
      nodeCount: nodeIndex.readingOrder.length,
    };
  }
  if (requestedRoles.has("Version Reader")) {
    roles["Version Reader"] = {
      valid: history.valid,
      targetChangeId: history.targetChangeId,
      revision: history.revision,
      versionCount: history.versions.length,
    };
  }
  if (requestedRoles.has("Core Writer")) {
    roles["Core Writer"] = {
      applicable: writeSimulation.applicable,
      resultRevision: writeSimulation.resultRevision,
      preservedRootId: writeSimulation.result.id,
    };
  }
  if (requestedRoles.has("Review Client")) {
    roles["Review Client"] = {
      annotationId: reviewAnnotation.id,
      targetState: targetResolution.state,
    };
  }
  if (requestedRoles.has("Change Producer")) {
    roles["Change Producer"] = {
      valid: proposalValidation.valid,
      authorType: proposal.author.type,
      status: proposal.status,
      operationCount: proposal.operations.length,
    };
  }
  if (requestedRoles.has("Change Applier")) {
    roles["Change Applier"] = {
      valid: accepted.valid,
      decisionActorType: accepted.package?.changes.at(-1)?.decision?.actor.type,
      resultRevision: accepted.package?.manifest.revision,
    };
  }
  if (requestedRoles.has("Projection Renderer")) {
    const kinds = entry.exercise?.projections;
    if (!Array.isArray(kinds)) {
      throw new Error(`Fixture ${entry.id} requires exercise.projections`);
    }
    const canonical = renderCanonicalHtml(snapshot);
    const projections = kinds.map((kind) => {
      const rendered = renderProjection(snapshot, kind);
      return {
        kind,
        revision: rendered.revision,
        reviewable: rendered.reviewable,
        segmentCount: rendered.segments.length,
      };
    });
    roles["Projection Renderer"] = {
      canonicalByteLength: canonical.bytes.byteLength,
      canonicalNodeOrder: canonical.nodeOrder,
      projections,
    };
  }

  return {
    format: "dstar-role-output/0.1",
    caseId: entry.id,
    dstar: snapshot.manifest.dstar,
    profiles: snapshot.manifest.profiles,
    roles,
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
