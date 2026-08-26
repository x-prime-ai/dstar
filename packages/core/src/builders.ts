import { cloneJson, deepFreezeJson } from "./json.js";
import type {
  DstarActor,
  DstarAnnotation,
  DstarChange,
  DstarDelegation,
  DstarDocument,
  DstarTarget,
  DstarUpdateOperation,
  JsonValue,
} from "./protocol.js";

function requireActor(
  actor: DstarActor,
  type: "agent" | "human",
  field: string,
): void {
  const article = type === "agent" ? "an" : "a";
  if (actor.type !== type)
    throw new TypeError(`${field} must be ${article} ${type} actor`);
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
  readonly createdAt: string;
  readonly document: DstarDocument;
  readonly sources?: readonly string[];
}

export function buildGenesisProposal(input: GenesisProposalInput): DstarChange {
  requireActor(input.author, "agent", "Genesis author");
  requireActor(input.requestActor, "human", "Genesis request actor");
  return freezeProtocol({
    id: input.id,
    kind: "genesis",
    idempotencyKey: input.idempotencyKey,
    author: input.author,
    request: {
      actor: input.requestActor,
      body: input.requestBody,
      createdAt: input.createdAt,
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
  readonly fulfills?: readonly string[];
  readonly sources?: readonly string[];
}

export function buildUpdateProposal(input: UpdateProposalInput): DstarChange {
  requireActor(input.author, "agent", "Update author");
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
    ...(input.fulfills ? { fulfills: [...input.fulfills] } : {}),
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
  readonly createdAt: string;
  readonly audience?: readonly [
    "human" | "agent" | "service",
    ...("human" | "agent" | "service")[],
  ];
}

export function buildAnnotation(input: AnnotationInput): DstarAnnotation {
  requireActor(input.author, "human", "Annotation author");
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
    replies: [],
    status: "open",
    createdAt: input.createdAt,
    ...(input.audience ? { audience: [...input.audience] } : {}),
  }) as unknown as DstarAnnotation;
}

export interface DelegationInput {
  readonly id: string;
  readonly annotationId: string;
  readonly assignee: DstarActor;
  readonly createdBy: DstarActor;
  readonly createdAt: string;
  readonly instruction?: string;
}

export function buildDelegation(input: DelegationInput): DstarDelegation {
  requireActor(input.assignee, "agent", "Delegation assignee");
  requireActor(input.createdBy, "human", "Delegation creator");
  return freezeProtocol({
    id: input.id,
    annotation: input.annotationId,
    assignee: input.assignee,
    createdBy: input.createdBy,
    status: "queued",
    createdAt: input.createdAt,
    ...(input.instruction ? { instruction: input.instruction } : {}),
  }) as DstarDelegation;
}
