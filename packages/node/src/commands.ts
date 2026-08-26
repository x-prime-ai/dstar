import {
  acceptGenesisProposal,
  acceptUpdateChange,
  buildAnnotation,
  buildDelegation,
  documentRevision,
  listCanonicalVersions,
  materializeVersion,
  parseIJson,
  rejectOrSupersedeChange,
  simulateUpdateChange,
  validateStructure,
  type AnnotationInput,
  type CanonicalVersionSummary,
  type DelegationInput,
  type Diagnostic,
  type DstarActor,
  type DstarAnnotation,
  type DstarChange,
  type DstarDelegation,
  type DstarSources,
  type GenesisPackageInput,
  type JsonValue,
  type VersionMaterialization,
} from "@dstar/core";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { openPackage, type PackageSnapshot } from "./package.js";
import {
  encodeJson,
  type IdempotencyCommand,
  type PackageRepository,
} from "./repository.js";

export interface CommandIdentity {
  readonly expectedSnapshotId: string;
  readonly idempotencyKey: string;
}

export interface ProposalResultInput {
  readonly change?: DstarChange;
  readonly delegationId: string;
  readonly completedBy: DstarActor;
  readonly completedAt: string;
  readonly reply?: NonNullable<DstarAnnotation["replies"]>[number];
  readonly reason?: string;
}

export interface GenesisDraftRequest {
  readonly output: string;
  readonly documentId: string;
  readonly title: string;
  readonly profiles: readonly [string, ...string[]];
  readonly actor: DstarActor;
  readonly body: string;
  readonly createdAt: string;
  readonly sources?: DstarSources;
}

export interface GenesisDraft {
  readonly format: "dstar-genesis-draft/0.1";
  readonly request: GenesisDraftRequest;
}

export class PackageCommandError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[] = []) {
    super(message);
    this.name = "PackageCommandError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function command(
  key: string,
  name: string,
  argumentsValue: JsonValue,
): IdempotencyCommand {
  return { key, arguments: { command: name, arguments: argumentsValue } };
}

function changePath(snapshot: PackageSnapshot, id: string): string {
  return `${snapshot.manifest.changes}/${id}.json`;
}

function annotationPath(snapshot: PackageSnapshot, id: string): string {
  return `${snapshot.manifest.annotations ?? "annotations"}/${id}.json`;
}

function delegationPath(snapshot: PackageSnapshot, id: string): string {
  return `${snapshot.manifest.delegations ?? "delegations"}/${id}.json`;
}

function updatedDelegation(
  input: ProposalResultInput,
  delegation: DstarDelegation,
): DstarDelegation {
  if (
    input.completedBy.type !== "agent" ||
    input.completedBy.id !== delegation.assignee.id
  ) {
    throw new PackageCommandError(
      "Only the assigned agent may complete a delegation",
    );
  }
  if (delegation.status !== "queued" && delegation.status !== "in_progress") {
    throw new PackageCommandError("Only an active delegation may be completed");
  }
  const results: NonNullable<DstarDelegation["results"]> = [
    ...(input.change
      ? [{ type: "change" as const, change: input.change.id }]
      : []),
    ...(input.reply
      ? [
          {
            type: "reply" as const,
            annotation: delegation.annotation,
            reply: input.reply.id,
          },
        ]
      : []),
  ];
  return {
    ...delegation,
    status: "completed",
    completedAt: input.completedAt,
    completedBy: input.completedBy,
    results,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export class PackageCommands {
  readonly repository: PackageRepository;

  constructor(repository: PackageRepository) {
    this.repository = repository;
  }

  async createAnnotation(
    snapshot: PackageSnapshot,
    input: AnnotationInput,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const annotation = buildAnnotation(input);
    if (
      snapshot.annotations.some((candidate) => candidate.id === annotation.id)
    ) {
      throw new PackageCommandError(
        `Annotation ${annotation.id} already exists`,
      );
    }
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "annotation",
      writes: new Map([
        [
          annotationPath(snapshot, annotation.id),
          encodeJson(asJson(annotation)),
        ],
      ]),
      idempotency: command(
        identity.idempotencyKey,
        "create-annotation",
        asJson(input),
      ),
    });
  }

  async createDelegation(
    snapshot: PackageSnapshot,
    input: DelegationInput,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const delegation = buildDelegation(input);
    if (
      snapshot.delegations.some((candidate) => candidate.id === delegation.id)
    ) {
      throw new PackageCommandError(
        `Delegation ${delegation.id} already exists`,
      );
    }
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "delegation",
      writes: new Map([
        [
          delegationPath(snapshot, delegation.id),
          encodeJson(asJson(delegation)),
        ],
      ]),
      idempotency: command(
        identity.idempotencyKey,
        "create-delegation",
        asJson(input),
      ),
    });
  }

  async recordProposalResult(
    snapshot: PackageSnapshot,
    input: ProposalResultInput,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const delegation = snapshot.delegations.find(
      (candidate) => candidate.id === input.delegationId,
    );
    if (!delegation)
      throw new PackageCommandError(
        `Delegation ${input.delegationId} does not exist`,
      );
    if (
      input.change &&
      snapshot.changes.some((candidate) => candidate.id === input.change?.id)
    ) {
      throw new PackageCommandError(`Change ${input.change.id} already exists`);
    }
    if (!input.change && !input.reply && !input.reason) {
      throw new PackageCommandError(
        "A terminal delegation result requires a proposal, reply, or reason",
      );
    }
    if (
      input.change &&
      (input.change.kind !== "update" ||
        input.change.status !== "proposed" ||
        input.change.author.type !== "agent" ||
        input.change.author.id !== delegation.assignee.id ||
        !input.change.fulfills?.includes(delegation.id) ||
        !input.change.motivatedBy?.includes(delegation.annotation))
    ) {
      throw new PackageCommandError(
        "Proposal result does not preserve delegation provenance",
      );
    }
    const nextDelegation = updatedDelegation(input, delegation);
    const writes = new Map<string, Uint8Array>([
      [
        delegationPath(snapshot, nextDelegation.id),
        encodeJson(asJson(nextDelegation)),
      ],
    ]);
    if (input.change) {
      writes.set(
        changePath(snapshot, input.change.id),
        encodeJson(asJson(input.change)),
      );
    }
    if (input.reply) {
      if (
        input.reply.author.type !== "agent" ||
        input.reply.author.id !== delegation.assignee.id
      ) {
        throw new PackageCommandError(
          "A delegation reply must be authored by the assigned agent",
        );
      }
      const annotation = snapshot.annotations.find(
        (candidate) => candidate.id === delegation.annotation,
      );
      if (!annotation)
        throw new PackageCommandError(
          `Annotation ${delegation.annotation} does not exist`,
        );
      writes.set(
        annotationPath(snapshot, annotation.id),
        encodeJson(
          asJson({
            ...annotation,
            replies: [...(annotation.replies ?? []), input.reply],
          }),
        ),
      );
    }
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "proposal",
      writes,
      idempotency: command(
        identity.idempotencyKey,
        "record-proposal-result",
        asJson(input),
      ),
    });
  }

  simulateChange(snapshot: PackageSnapshot, changeId: string) {
    return simulateUpdateChange(snapshot, changeId);
  }

  async acceptChange(
    snapshot: PackageSnapshot,
    changeId: string,
    actor: DstarActor,
    decidedAt: string,
    expectedResultRevision: string,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const decision = acceptUpdateChange(
      snapshot,
      changeId,
      actor,
      decidedAt,
      expectedResultRevision,
    );
    if (!decision.valid || !decision.package) {
      throw new PackageCommandError(
        "Change cannot be accepted",
        decision.diagnostics,
      );
    }
    const accepted = decision.package.changes.find(
      (change) => change.id === changeId,
    );
    if (!accepted)
      throw new PackageCommandError(
        "Accepted change is missing from decision result",
      );
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "accept-change",
      writes: new Map([
        [
          snapshot.manifest.document,
          encodeJson(asJson(decision.package.document)),
        ],
        ["manifest.json", encodeJson(asJson(decision.package.manifest))],
        [changePath(snapshot, changeId), encodeJson(asJson(accepted))],
      ]),
      idempotency: command(identity.idempotencyKey, "accept-change", {
        changeId,
        actor: asJson(actor),
        decidedAt,
        expectedResultRevision,
      }),
    });
  }

  async rejectChange(
    snapshot: PackageSnapshot,
    changeId: string,
    actor: DstarActor,
    decidedAt: string,
    reason: string | undefined,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const decision = rejectOrSupersedeChange(
      snapshot,
      changeId,
      "rejected",
      actor,
      decidedAt,
      reason,
    );
    if (!decision.valid || !decision.package) {
      throw new PackageCommandError(
        "Change cannot be rejected",
        decision.diagnostics,
      );
    }
    const rejected = decision.package.changes.find(
      (change) => change.id === changeId,
    );
    if (!rejected)
      throw new PackageCommandError(
        "Rejected change is missing from decision result",
      );
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "decision",
      writes: new Map([
        [changePath(snapshot, changeId), encodeJson(asJson(rejected))],
      ]),
      idempotency: command(identity.idempotencyKey, "reject-change", {
        changeId,
        actor: asJson(actor),
        decidedAt,
        ...(reason ? { reason } : {}),
      }),
    });
  }

  history(snapshot: PackageSnapshot): readonly CanonicalVersionSummary[] {
    return listCanonicalVersions(snapshot);
  }

  showVersion(
    snapshot: PackageSnapshot,
    changeId: string,
  ): VersionMaterialization {
    return materializeVersion(snapshot, changeId);
  }
}

export async function createGenesisDraft(
  requestFile: string,
  draftDirectory: string,
): Promise<GenesisDraft> {
  const request = parseIJson(await readFile(resolve(requestFile)))
    .value as unknown as GenesisDraftRequest;
  if (
    request.actor?.type !== "human" ||
    typeof request.output !== "string" ||
    typeof request.documentId !== "string" ||
    typeof request.title !== "string" ||
    typeof request.body !== "string" ||
    !Array.isArray(request.profiles) ||
    request.profiles.length === 0
  ) {
    throw new PackageCommandError(
      "Genesis request is malformed or is not human-authored",
    );
  }
  const draft: GenesisDraft = { format: "dstar-genesis-draft/0.1", request };
  await mkdir(resolve(draftDirectory), { recursive: false });
  await writeFile(
    join(resolve(draftDirectory), "draft.json"),
    encodeJson(asJson(draft)),
  );
  return draft;
}

export async function stageGenesisProposal(
  draftDirectory: string,
  proposal: DstarChange,
): Promise<void> {
  if (
    proposal.kind !== "genesis" ||
    proposal.status !== "proposed" ||
    proposal.author.type !== "agent"
  ) {
    throw new PackageCommandError(
      "Genesis proposal must be proposed and agent-authored",
    );
  }
  const validation = validateStructure("change", proposal);
  if (!validation.valid)
    throw new PackageCommandError(
      "Genesis proposal is invalid",
      validation.diagnostics,
    );
  await writeFile(
    join(resolve(draftDirectory), "proposal.json"),
    encodeJson(asJson(proposal)),
    { flag: "wx" },
  );
}

export async function acceptGenesisDraft(
  draftDirectory: string,
  actor: DstarActor,
  decidedAt: string,
  expectedResultRevision: string,
): Promise<PackageSnapshot> {
  if (actor.type !== "human")
    throw new PackageCommandError("Genesis decisions require a human actor");
  const draftRoot = resolve(draftDirectory);
  const draft = parseIJson(await readFile(join(draftRoot, "draft.json")))
    .value as unknown as GenesisDraft;
  const proposal = parseIJson(await readFile(join(draftRoot, "proposal.json")))
    .value as unknown as DstarChange;
  if (
    draft.format !== "dstar-genesis-draft/0.1" ||
    proposal.request?.actor.type !== "human" ||
    proposal.request.actor.id !== draft.request.actor.id ||
    proposal.request.body !== draft.request.body ||
    proposal.request.createdAt !== draft.request.createdAt
  ) {
    throw new PackageCommandError(
      "Genesis proposal does not preserve the human draft request",
    );
  }
  const approvedSourceIds = new Set(
    draft.request.sources?.sources.map((source) => source.id) ?? [],
  );
  if (proposal.sources?.some((sourceId) => !approvedSourceIds.has(sourceId))) {
    throw new PackageCommandError(
      "Genesis proposal references a source not approved in the draft",
    );
  }
  const packageInput: GenesisPackageInput = {
    documentId: draft.request.documentId,
    title: draft.request.title,
    profiles: draft.request.profiles,
  };
  const decision = acceptGenesisProposal(
    proposal,
    packageInput,
    actor,
    decidedAt,
    expectedResultRevision,
  );
  if (!decision.valid || !decision.package) {
    throw new PackageCommandError(
      "Genesis proposal cannot be accepted",
      decision.diagnostics,
    );
  }
  const output = resolve(dirname(draftRoot), draft.request.output);
  if (!output.endsWith(".dstar"))
    throw new PackageCommandError("Genesis output must end in .dstar");
  try {
    await stat(output);
    const existing = await openPackage(output);
    const accepted = existing.changes.find(
      (change) => change.id === proposal.id,
    );
    if (
      accepted?.status === "accepted" &&
      existing.manifest.revision === expectedResultRevision
    )
      return existing;
    throw new PackageCommandError(
      "Genesis output already exists with different content",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${output}.${randomUUID()}.tmp.dstar`;
  try {
    await mkdir(join(temporary, "changes"), { recursive: true });
    await writeFile(
      join(temporary, "document.json"),
      encodeJson(asJson(decision.package.document)),
    );
    await writeFile(
      join(temporary, "changes", `${proposal.id}.json`),
      encodeJson(asJson(decision.package.changes[0])),
    );
    if (draft.request.sources) {
      await writeFile(
        join(temporary, "sources.json"),
        encodeJson(asJson(draft.request.sources)),
      );
    }
    const manifest = {
      ...decision.package.manifest,
      ...(draft.request.sources ? { sources: "sources.json" } : {}),
    };
    await writeFile(
      join(temporary, "manifest.json"),
      encodeJson(asJson(manifest)),
    );
    await openPackage(temporary);
    await rename(temporary, output);
    return openPackage(output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function genesisProposalRevision(proposal: DstarChange): string {
  const operation = proposal.operations[0];
  if (proposal.kind !== "genesis" || operation?.op !== "create_document") {
    throw new PackageCommandError("Not a genesis proposal");
  }
  return documentRevision(operation.value);
}
