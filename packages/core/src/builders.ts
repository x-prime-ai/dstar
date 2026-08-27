import { cloneJson, deepFreezeJson } from "./json.js";
import type {
  DstarActor,
  DstarAnnotation,
  DstarChange,
  DstarDocument,
  DstarTarget,
  DstarUpdateOperation,
  JsonValue,
} from "./protocol.js";

function requireActor(actor: DstarActor, type: "human", field: string): void {
  if (actor.type !== type)
    throw new TypeError(`${field} must be a ${type} actor`);
}

function freezeProtocol<T>(value: T): T {
  return deepFreezeJson(cloneJson(value as JsonValue)) as T;
}

export interface GenesisProposalInput {
  readonly id: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly author: DstarActor;
  readonly requestActor: DstarActor;
  readonly requestBody: string;
  readonly requestCreatedAt?: string;
  readonly createdAt: string;
  readonly document: DstarDocument;
  readonly sources?: readonly string[];
}

export function buildGenesisProposal(input: GenesisProposalInput): DstarChange {
  requireActor(input.requestActor, "human", "Genesis request actor");
  return freezeProtocol({
    id: input.id,
    kind: "genesis",
    idempotencyKey: input.idempotencyKey,
    author: input.author,
    request: {
      actor: input.requestActor,
      body: input.requestBody,
      createdAt: input.requestCreatedAt ?? input.createdAt,
    },
    operations: [
      { id: input.operationId, op: "create_document", value: input.document },
    ],
    status: "proposed",
    createdAt: input.createdAt,
    ...(input.sources ? { sources: [...input.sources] } : {}),
  }) as DstarChange;
}

export interface UpdateProposalInput {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly author: DstarActor;
  readonly baseChange: string;
  readonly baseRevision: string;
  readonly operations: readonly DstarUpdateOperation[];
  readonly createdAt: string;
  readonly motivatedBy?: readonly string[];
  readonly sources?: readonly string[];
}

export function buildUpdateProposal(input: UpdateProposalInput): DstarChange {
  if (input.operations.length === 0)
    throw new TypeError("An update proposal requires at least one operation");
  return freezeProtocol({
    id: input.id,
    kind: "update",
    idempotencyKey: input.idempotencyKey,
    baseChange: input.baseChange,
    baseRevision: input.baseRevision,
    author: input.author,
    operations: [...input.operations],
    status: "proposed",
    createdAt: input.createdAt,
    ...(input.motivatedBy ? { motivatedBy: [...input.motivatedBy] } : {}),
    ...(input.sources ? { sources: [...input.sources] } : {}),
  }) as DstarChange;
}

export interface AnnotationInput {
  readonly id: string;
  readonly purpose: "discussion" | "question" | "change-request";
  readonly scope: "canonical" | "projection" | "both";
  readonly target: DstarTarget;
  readonly canonicalTargets?: DstarAnnotation["canonicalTargets"];
  readonly body: string;
  readonly author: DstarActor;
  readonly assignee?: DstarActor;
  readonly createdAt: string;
  readonly audience?: readonly [
    "human" | "service",
    ...("human" | "service")[],
  ];
}

export function buildAnnotation(input: AnnotationInput): DstarAnnotation {
  requireActor(input.author, "human", "Annotation author");
  if (input.assignee)
    requireActor(input.assignee, "human", "Annotation assignee");
  if (input.body.length === 0)
    throw new TypeError("Annotation body must not be empty");
  return freezeProtocol({
    id: input.id,
    type: "comment",
    purpose: input.purpose,
    scope: input.scope,
    target: input.target,
    ...(input.canonicalTargets
      ? { canonicalTargets: input.canonicalTargets }
      : {}),
    body: input.body,
    author: input.author,
    ...(input.assignee ? { assignee: input.assignee } : {}),
    replies: [],
    status: "open",
    createdAt: input.createdAt,
    ...(input.audience ? { audience: [...input.audience] } : {}),
  }) as unknown as DstarAnnotation;
}
