import {
  acceptGenesisProposal,
  acceptUpdateChange,
  buildAnnotation,
  documentRevision,
  listCanonicalVersions,
  materializeVersion,
  parseIJson,
  rejectOrSupersedeChange,
  revisionOf,
  simulateUpdateChange,
  validateStructure,
  type AnnotationInput,
  type CanonicalVersionSummary,
  type Diagnostic,
  type DstarActor,
  type DstarAnnotation,
  type DstarChange,
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

export interface ProposalSubmissionInput {
  readonly change?: DstarChange;
  readonly annotationId?: string;
  readonly reply?: NonNullable<DstarAnnotation["replies"]>[number];
}

export interface AnnotationReplyInput {
  readonly annotationId: string;
  readonly reply: NonNullable<DstarAnnotation["replies"]>[number];
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

function samePortableValue(left: unknown, right: unknown): boolean {
  return revisionOf(left as JsonValue) === revisionOf(right as JsonValue);
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
    const existing = snapshot.annotations.find(
      (candidate) => candidate.id === annotation.id,
    );
    if (existing) {
      if (samePortableValue(existing, annotation)) return snapshot;
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

  async addHumanReply(
    snapshot: PackageSnapshot,
    input: AnnotationReplyInput,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const annotation = snapshot.annotations.find(
      (candidate) => candidate.id === input.annotationId,
    );
    if (!annotation)
      throw new PackageCommandError(
        `Annotation ${input.annotationId} does not exist`,
      );
    if (input.reply.author.type !== "human" || input.reply.body.length === 0)
      throw new PackageCommandError(
        "A direct review reply must be non-empty and human-authored",
      );
    const existingReply = (annotation.replies ?? []).find(
      (candidate) => candidate.id === input.reply.id,
    );
    if (existingReply) {
      if (samePortableValue(existingReply, input.reply)) return snapshot;
      throw new PackageCommandError(`Reply ${input.reply.id} already exists`);
    }
    const updated: DstarAnnotation = {
      ...annotation,
      replies: [...(annotation.replies ?? []), input.reply],
    };
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "annotation",
      writes: new Map([
        [annotationPath(snapshot, annotation.id), encodeJson(asJson(updated))],
      ]),
      idempotency: command(
        identity.idempotencyKey,
        "add-human-reply",
        asJson(input),
      ),
    });
  }

  async resolveAnnotation(
    snapshot: PackageSnapshot,
    annotationId: string,
    actor: DstarActor,
    resolvedAt: string,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    const annotation = snapshot.annotations.find(
      (candidate) => candidate.id === annotationId,
    );
    if (!annotation)
      throw new PackageCommandError(
        `Annotation ${annotationId} does not exist`,
      );
    if (actor.type !== "human")
      throw new PackageCommandError("Only a human may resolve an annotation");
    if (annotation.status !== "open")
      throw new PackageCommandError("Only an open annotation may be resolved");
    const resolved: DstarAnnotation = {
      ...annotation,
      status: "resolved",
      resolvedAt,
      resolvedBy: actor as NonNullable<DstarAnnotation["resolvedBy"]>,
    };
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "annotation",
      writes: new Map([
        [annotationPath(snapshot, annotation.id), encodeJson(asJson(resolved))],
      ]),
      idempotency: command(identity.idempotencyKey, "resolve-annotation", {
        annotationId,
        actor: asJson(actor),
        resolvedAt,
      }),
    });
  }

  async assignAnnotation(
    snapshot: PackageSnapshot,
    annotationId: string,
    assignee: DstarActor,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    if (assignee.type !== "human")
      throw new PackageCommandError("Annotation assignee must be human");
    const annotation = snapshot.annotations.find(
      (candidate) => candidate.id === annotationId,
    );
    if (!annotation)
      throw new PackageCommandError(
        `Annotation ${annotationId} does not exist`,
      );
    const updated: DstarAnnotation = {
      ...annotation,
      assignee: assignee as NonNullable<DstarAnnotation["assignee"]>,
    };
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "annotation",
      writes: new Map([
        [annotationPath(snapshot, annotation.id), encodeJson(asJson(updated))],
      ]),
      idempotency: command(identity.idempotencyKey, "assign-annotation", {
        annotationId,
        assignee: asJson(assignee),
      }),
    });
  }

  async recordProposal(
    snapshot: PackageSnapshot,
    input: ProposalSubmissionInput,
    identity: CommandIdentity,
  ): Promise<PackageSnapshot> {
    if (!input.change && !input.reply) {
      throw new PackageCommandError(
        "A proposal submission requires a change or reply",
      );
    }
    if (
      input.change &&
      (input.change.kind !== "update" || input.change.status !== "proposed")
    ) {
      throw new PackageCommandError("Only a proposed update may be recorded");
    }
    const writes = new Map<string, Uint8Array>();
    if (input.change) {
      const existingChange = snapshot.changes.find(
        (candidate) => candidate.id === input.change?.id,
      );
      if (existingChange) {
        if (!samePortableValue(existingChange, input.change))
          throw new PackageCommandError(
            `Change ${input.change.id} already exists`,
          );
      } else {
        writes.set(
          changePath(snapshot, input.change.id),
          encodeJson(asJson(input.change)),
        );
      }
    }
    if (input.reply) {
      if (!input.annotationId)
        throw new PackageCommandError("A reply requires annotationId");
      const annotation = snapshot.annotations.find(
        (candidate) => candidate.id === input.annotationId,
      );
      if (!annotation)
        throw new PackageCommandError(
          `Annotation ${input.annotationId} does not exist`,
        );
      const existingReply = (annotation.replies ?? []).find(
        (candidate) => candidate.id === input.reply?.id,
      );
      if (existingReply) {
        if (!samePortableValue(existingReply, input.reply))
          throw new PackageCommandError(
            `Reply ${input.reply.id} already exists`,
          );
      } else {
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
    }
    if (writes.size === 0) return snapshot;
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "proposal",
      writes,
      idempotency: command(
        identity.idempotencyKey,
        "record-proposal",
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

  async supersedeChange(
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
      "superseded",
      actor,
      decidedAt,
      reason,
    );
    if (!decision.valid || !decision.package)
      throw new PackageCommandError(
        "Change cannot be superseded",
        decision.diagnostics,
      );
    const superseded = decision.package.changes.find(
      (change) => change.id === changeId,
    );
    if (!superseded)
      throw new PackageCommandError(
        "Superseded change is missing from decision result",
      );
    return this.repository.commit(snapshot, {
      expectedSnapshotId: identity.expectedSnapshotId,
      transactionType: "decision",
      writes: new Map([
        [changePath(snapshot, changeId), encodeJson(asJson(superseded))],
      ]),
      idempotency: command(identity.idempotencyKey, "supersede-change", {
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
    validateStructure("change", proposal).valid === false
  ) {
    throw new PackageCommandError(
      "Genesis proposal must be a valid proposed change",
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
