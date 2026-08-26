import { createDiagnostic, type Diagnostic } from "./diagnostics.js";
import { cloneJson, deepFreezeJson } from "./json.js";
import { simulateOperations, type SemanticDiff } from "./operations.js";
import { validateBaseProfile } from "./profile-validation.js";
import type {
  DstarActor,
  DstarChange,
  DstarDocument,
  DstarUpdateOperation,
  InMemoryPackage,
  JsonValue,
} from "./protocol.js";
import { documentRevision, type Sha256Revision } from "./revisions.js";
import { validateStructure } from "./structural-validation.js";

export interface CanonicalVersionSummary {
  readonly changeId: string;
  readonly kind: "genesis" | "update";
  readonly resultRevision: string;
  readonly agentAuthorId: string;
  readonly humanDecisionActorId: string;
  readonly decidedAt: string;
}

export interface VersionMaterialization {
  readonly valid: boolean;
  readonly targetChangeId: string;
  readonly document?: DstarDocument;
  readonly revision?: Sha256Revision;
  readonly versions: readonly CanonicalVersionSummary[];
  readonly diagnostics: readonly Diagnostic[];
}

function invalidHistory(summary: string, objectId?: string): Diagnostic {
  return createDiagnostic("HISTORY_CHAIN_INVALID", {
    summary,
    ...(objectId ? { location: { objectId } } : {}),
  });
}

function resultRevision(change: DstarChange): string | undefined {
  return change.status === "accepted"
    ? change.decision?.resultRevision
    : undefined;
}

export function acceptedChain(pkg: InMemoryPackage): {
  readonly chain: readonly DstarChange[];
  readonly diagnostics: readonly Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map<string, DstarChange>();
  for (const change of pkg.changes) {
    if (byId.has(change.id))
      diagnostics.push(
        invalidHistory(`Duplicate change ID ${change.id}.`, change.id),
      );
    byId.set(change.id, change);
  }

  const reverseChain: DstarChange[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = pkg.manifest.headChange;
  while (currentId !== undefined) {
    if (visited.has(currentId)) {
      diagnostics.push(
        invalidHistory("Accepted change chain contains a cycle.", currentId),
      );
      break;
    }
    visited.add(currentId);
    const change = byId.get(currentId);
    if (!change || change.status !== "accepted") {
      diagnostics.push(
        invalidHistory(
          `Accepted head chain references missing or non-accepted ${currentId}.`,
          currentId,
        ),
      );
      break;
    }
    reverseChain.push(change);
    if (change.kind === "genesis") break;
    currentId = change.baseChange;
  }

  const chain = reverseChain.reverse();
  if (chain[0]?.kind !== "genesis")
    diagnostics.push(
      invalidHistory("Accepted chain does not begin with genesis."),
    );
  const accepted = pkg.changes.filter((change) => change.status === "accepted");
  const acceptedGenesis = accepted.filter(
    (change) => change.kind === "genesis",
  );
  if (acceptedGenesis.length !== 1) {
    diagnostics.push(
      invalidHistory(
        `Package must contain exactly one accepted genesis; found ${acceptedGenesis.length}.`,
      ),
    );
  }
  for (const change of accepted) {
    if (!visited.has(change.id))
      diagnostics.push(
        invalidHistory(
          "Accepted change is off the manifest head chain.",
          change.id,
        ),
      );
  }
  return Object.freeze({
    chain: Object.freeze(chain),
    diagnostics: Object.freeze(diagnostics),
  });
}

function versionSummary(
  change: DstarChange,
): CanonicalVersionSummary | undefined {
  const revision = resultRevision(change);
  const decision = change.decision;
  if (!revision || !decision) return undefined;
  return Object.freeze({
    changeId: change.id,
    kind: change.kind,
    resultRevision: revision,
    agentAuthorId: change.author.id,
    humanDecisionActorId: decision.actor.id,
    decidedAt: decision.at,
  });
}

export function listCanonicalVersions(
  pkg: InMemoryPackage,
): readonly CanonicalVersionSummary[] {
  const materialization = materializeVersion(pkg, pkg.manifest.headChange);
  return materialization.valid ? materialization.versions : Object.freeze([]);
}

export function materializeVersion(
  pkg: InMemoryPackage,
  targetChangeId: string,
): VersionMaterialization {
  const chainResult = acceptedChain(pkg);
  const diagnostics = [...chainResult.diagnostics];
  const targetIndex = chainResult.chain.findIndex(
    (change) => change.id === targetChangeId,
  );
  if (targetIndex < 0) {
    diagnostics.push(
      invalidHistory(
        "Requested version is not an accepted change on the canonical chain.",
        targetChangeId,
      ),
    );
    return Object.freeze({
      valid: false,
      targetChangeId,
      versions: Object.freeze([]),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const prefix = chainResult.chain.slice(0, targetIndex + 1);
  const genesis = prefix[0];
  const genesisOperation = genesis?.operations[0];
  if (
    !genesis ||
    genesis.kind !== "genesis" ||
    genesisOperation?.op !== "create_document"
  ) {
    diagnostics.push(
      invalidHistory(
        "Genesis must contain exactly one create_document operation.",
        genesis?.id,
      ),
    );
    return Object.freeze({
      valid: false,
      targetChangeId,
      versions: Object.freeze([]),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  let document = deepFreezeJson(
    cloneJson(genesisOperation.value as JsonValue),
  ) as DstarDocument;
  const genesisStructure = validateStructure("document", document);
  diagnostics.push(...genesisStructure.diagnostics);
  diagnostics.push(...validateBaseProfile(document, pkg.manifest.profiles));
  let revision = documentRevision(document);
  if (resultRevision(genesis) !== revision) {
    diagnostics.push(
      createDiagnostic("REV_MISMATCH", {
        summary:
          "Genesis resultRevision does not match its create_document value.",
        location: { objectId: genesis.id },
        details: { expected: resultRevision(genesis), actual: revision },
      }),
    );
  }

  const summaries: CanonicalVersionSummary[] = [];
  const genesisSummary = versionSummary(genesis);
  if (genesisSummary) summaries.push(genesisSummary);
  let previousChange = genesis;
  for (const change of prefix.slice(1)) {
    if (change.kind !== "update") {
      diagnostics.push(
        invalidHistory(
          "Only the first accepted change may be genesis.",
          change.id,
        ),
      );
      break;
    }
    if (
      change.baseChange !== previousChange.id ||
      change.baseRevision !== revision
    ) {
      diagnostics.push(
        invalidHistory(
          "Accepted update bases do not identify the immediately preceding version.",
          change.id,
        ),
      );
      break;
    }
    const simulation = simulateOperations(
      document,
      change.operations as readonly DstarUpdateOperation[],
      pkg.manifest.profiles,
    );
    diagnostics.push(...simulation.diagnostics);
    if (
      !simulation.applicable ||
      !simulation.result ||
      !simulation.resultRevision
    )
      break;
    document = simulation.result;
    revision = simulation.resultRevision;
    if (resultRevision(change) !== revision) {
      diagnostics.push(
        createDiagnostic("REV_MISMATCH", {
          summary:
            "Accepted update resultRevision does not match replayed content.",
          location: { objectId: change.id },
          details: { expected: resultRevision(change), actual: revision },
        }),
      );
      break;
    }
    const summary = versionSummary(change);
    if (summary) summaries.push(summary);
    previousChange = change;
  }

  const hasErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (!hasErrors && targetChangeId === pkg.manifest.headChange) {
    if (
      revision !== pkg.manifest.revision ||
      documentRevision(pkg.document) !== revision
    ) {
      diagnostics.push(
        createDiagnostic("REV_MISMATCH", {
          summary:
            "Materialized head does not match manifest revision and document.json.",
          location: { objectId: targetChangeId },
        }),
      );
    }
  }

  const valid = !diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  return Object.freeze({
    valid,
    targetChangeId,
    ...(valid ? { document, revision } : {}),
    versions: Object.freeze(summaries),
    diagnostics: Object.freeze(diagnostics),
  });
}

export type ChangeApplicability =
  "applicable" | "stale-base" | "local-conflict" | "invalid";

export interface ChangeSimulation {
  readonly changeId: string;
  readonly applicability: ChangeApplicability;
  readonly baseChangeMatches: boolean;
  readonly baseRevisionMatches: boolean;
  readonly result?: DstarDocument;
  readonly resultRevision?: Sha256Revision;
  readonly semanticDiff?: SemanticDiff;
  readonly diagnostics: readonly Diagnostic[];
}

export function simulateUpdateChange(
  pkg: InMemoryPackage,
  changeId: string,
): ChangeSimulation {
  const change = pkg.changes.find((candidate) => candidate.id === changeId);
  if (
    !change ||
    change.kind !== "update" ||
    change.status !== "proposed" ||
    change.author.type !== "agent"
  ) {
    return Object.freeze({
      changeId,
      applicability: "invalid",
      baseChangeMatches: false,
      baseRevisionMatches: false,
      diagnostics: Object.freeze([
        createDiagnostic("OP_INVALID", {
          summary: "Change is not an agent-authored proposed update.",
        }),
      ]),
    });
  }
  const structure = validateStructure("change", change);
  const base = pkg.changes.find(
    (candidate) => candidate.id === change.baseChange,
  );
  if (
    !structure.valid ||
    !base ||
    base.status !== "accepted" ||
    base.decision?.resultRevision !== change.baseRevision
  ) {
    return Object.freeze({
      changeId,
      applicability: "invalid",
      baseChangeMatches: false,
      baseRevisionMatches: false,
      diagnostics: Object.freeze([
        ...structure.diagnostics,
        invalidHistory(
          "Update bases do not identify an accepted canonical version.",
          change.id,
        ),
      ]),
    });
  }
  const baseChangeMatches = change.baseChange === pkg.manifest.headChange;
  const baseRevisionMatches = change.baseRevision === pkg.manifest.revision;
  const operationResult = simulateOperations(
    pkg.document,
    change.operations as readonly DstarUpdateOperation[],
    pkg.manifest.profiles,
  );
  const conflict = operationResult.operations.some(
    (operation) => operation.outcome === "conflict",
  );
  const invalid = operationResult.operations.some(
    (operation) => operation.outcome === "invalid",
  );
  const applicability: ChangeApplicability =
    !baseChangeMatches || !baseRevisionMatches
      ? "stale-base"
      : invalid
        ? "invalid"
        : conflict
          ? "local-conflict"
          : "applicable";
  return Object.freeze({
    changeId,
    applicability,
    baseChangeMatches,
    baseRevisionMatches,
    ...(operationResult.result ? { result: operationResult.result } : {}),
    ...(operationResult.resultRevision
      ? { resultRevision: operationResult.resultRevision }
      : {}),
    ...(operationResult.semanticDiff
      ? { semanticDiff: operationResult.semanticDiff }
      : {}),
    diagnostics: operationResult.diagnostics,
  });
}

export interface PureDecisionResult {
  readonly valid: boolean;
  readonly package?: InMemoryPackage;
  readonly diagnostics: readonly Diagnostic[];
}

export interface GenesisPackageInput {
  readonly documentId: string;
  readonly title: string;
  readonly profiles: readonly [string, ...string[]];
}

export function acceptGenesisProposal(
  proposal: DstarChange,
  packageInput: GenesisPackageInput,
  actor: DstarActor,
  decidedAt: string,
  expectedResultRevision: string,
): PureDecisionResult {
  if (actor.type !== "human") {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN"),
      ]),
    });
  }
  const operation = proposal.operations[0];
  if (
    proposal.kind !== "genesis" ||
    proposal.status !== "proposed" ||
    proposal.author.type !== "agent" ||
    proposal.request?.actor.type !== "human" ||
    proposal.operations.length !== 1 ||
    operation?.op !== "create_document"
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        createDiagnostic("OP_INVALID", {
          summary:
            "Genesis must be one proposed agent-authored create_document.",
        }),
      ]),
    });
  }
  const structure = validateStructure("document", operation.value);
  const profileDiagnostics = validateBaseProfile(
    operation.value,
    packageInput.profiles,
  );
  const revision = documentRevision(operation.value);
  const diagnostics = [...structure.diagnostics, ...profileDiagnostics];
  if (revision !== expectedResultRevision) {
    diagnostics.push(
      createDiagnostic("REV_MISMATCH", {
        summary:
          "Human confirmation does not match the genesis document revision.",
        details: { expected: expectedResultRevision, actual: revision },
      }),
    );
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze(diagnostics),
    });
  }
  const acceptedProposal = {
    ...(cloneJson(proposal as JsonValue) as unknown as Record<
      string,
      JsonValue
    >),
    status: "accepted",
    decision: {
      status: "accepted",
      actor: cloneJson(actor as JsonValue),
      at: decidedAt,
      resultRevision: revision,
    },
  } as unknown as DstarChange;
  const pkg = deepFreezeJson({
    manifest: {
      dstar: "0.1",
      id: packageInput.documentId,
      revision,
      headChange: proposal.id,
      title: packageInput.title,
      profiles: [...packageInput.profiles],
      document: "document.json",
      changes: "changes",
    },
    document: cloneJson(operation.value as JsonValue),
    annotations: [],
    delegations: [],
    changes: [acceptedProposal],
  } as JsonValue) as unknown as InMemoryPackage;
  return Object.freeze({
    valid: true,
    package: pkg,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function rejectOrSupersedeChange(
  pkg: InMemoryPackage,
  changeId: string,
  status: "rejected" | "superseded",
  actor: DstarActor,
  decidedAt: string,
  reason?: string,
): PureDecisionResult {
  if (actor.type !== "human") {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN"),
      ]),
    });
  }
  const target = pkg.changes.find((change) => change.id === changeId);
  if (!target || target.status !== "proposed") {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        createDiagnostic("OP_INVALID", {
          summary: "Only a proposed change may be rejected or superseded.",
        }),
      ]),
    });
  }
  const changes = pkg.changes.map((change) =>
    change.id === changeId
      ? ({
          ...(cloneJson(change as JsonValue) as unknown as Record<
            string,
            JsonValue
          >),
          status,
          decision: {
            status,
            actor: cloneJson(actor as JsonValue),
            at: decidedAt,
            ...(reason ? { reason } : {}),
          },
        } as unknown as DstarChange)
      : change,
  );
  const nextPackage = deepFreezeJson({
    manifest: cloneJson(pkg.manifest as JsonValue),
    document: cloneJson(pkg.document as JsonValue),
    annotations: cloneJson(pkg.annotations as unknown as JsonValue),
    delegations: cloneJson(pkg.delegations as unknown as JsonValue),
    changes,
    ...(pkg.sources
      ? { sources: cloneJson(pkg.sources as unknown as JsonValue) }
      : {}),
    ...(pkg.projections
      ? { projections: cloneJson(pkg.projections as JsonValue) }
      : {}),
  } as JsonValue) as unknown as InMemoryPackage;
  return Object.freeze({
    valid: true,
    package: nextPackage,
    diagnostics: Object.freeze([]),
  });
}

export function acceptUpdateChange(
  pkg: InMemoryPackage,
  changeId: string,
  actor: DstarActor,
  decidedAt: string,
  expectedResultRevision: string,
): PureDecisionResult {
  if (actor.type !== "human") {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN"),
      ]),
    });
  }
  const simulation = simulateUpdateChange(pkg, changeId);
  if (
    simulation.applicability !== "applicable" ||
    !simulation.result ||
    simulation.resultRevision !== expectedResultRevision
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        ...simulation.diagnostics,
        createDiagnostic("REV_MISMATCH", {
          summary:
            "Human confirmation does not match an applicable simulation result.",
        }),
      ]),
    });
  }
  const changes = pkg.changes.map((change) =>
    change.id === changeId
      ? ({
          ...(cloneJson(change as JsonValue) as unknown as Record<
            string,
            JsonValue
          >),
          status: "accepted",
          decision: {
            status: "accepted",
            actor: cloneJson(actor as JsonValue),
            at: decidedAt,
            resultRevision: simulation.resultRevision,
          },
        } as DstarChange)
      : change,
  );
  const manifest = {
    ...(cloneJson(pkg.manifest as JsonValue) as unknown as Record<
      string,
      JsonValue
    >),
    revision: simulation.resultRevision,
    headChange: changeId,
  };
  const nextPackage = deepFreezeJson({
    manifest,
    document: simulation.result,
    annotations: cloneJson(pkg.annotations as unknown as JsonValue),
    delegations: cloneJson(pkg.delegations as unknown as JsonValue),
    changes,
    ...(pkg.sources
      ? { sources: cloneJson(pkg.sources as unknown as JsonValue) }
      : {}),
    ...(pkg.projections
      ? { projections: cloneJson(pkg.projections as JsonValue) }
      : {}),
  } as JsonValue) as unknown as InMemoryPackage;
  return Object.freeze({
    valid: true,
    package: nextPackage,
    diagnostics: Object.freeze([]),
  });
}
