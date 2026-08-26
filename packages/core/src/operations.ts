import { createDiagnostic, type Diagnostic } from "./diagnostics.js";
import { DocumentIndex, nodeTextStream } from "./indexes.js";
import { cloneJson, deepFreezeJson } from "./json.js";
import { validateBaseProfile } from "./profile-validation.js";
import type {
  DstarDocument,
  DstarInline,
  DstarNode,
  DstarUpdateOperation,
  JsonValue,
} from "./protocol.js";
import {
  canonicalize,
  documentRevision,
  nodeRevision,
  type Sha256Revision,
} from "./revisions.js";
import { codePointLength, codePointSlice } from "./selectors.js";
import { validateStructure } from "./structural-validation.js";

export type OperationOutcome =
  "applied" | "conflict" | "invalid" | "not-evaluated";

export interface OperationSimulation {
  readonly operationId: string;
  readonly operation: DstarUpdateOperation["op"];
  readonly outcome: OperationOutcome;
  readonly diagnostics: readonly Diagnostic[];
}

export interface NodeMove {
  readonly nodeId: string;
  readonly fromParentId: string;
  readonly toParentId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface NodeModification {
  readonly nodeId: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly attrsChanged: boolean;
  readonly inlineChanged: boolean;
}

export interface SemanticDiff {
  readonly insertedNodeIds: readonly string[];
  readonly deletedNodeIds: readonly string[];
  readonly movedNodes: readonly NodeMove[];
  readonly modifiedNodes: readonly NodeModification[];
}

export interface OperationSimulationResult {
  readonly applicable: boolean;
  readonly result?: DstarDocument;
  readonly resultRevision?: Sha256Revision;
  readonly operations: readonly OperationSimulation[];
  readonly semanticDiff?: SemanticDiff;
  readonly diagnostics: readonly Diagnostic[];
}

interface MutableNode {
  id: string;
  type: string;
  attrs?: Record<string, unknown>;
  content?: DstarInline[];
  children?: MutableNode[];
  [key: string]: unknown;
}

interface LocatedNode {
  readonly node: MutableNode;
  readonly parent?: MutableNode;
  readonly index: number;
}

class OperationFailure extends Error {
  readonly outcome: "conflict" | "invalid";
  readonly diagnostic: Diagnostic;

  constructor(outcome: "conflict" | "invalid", diagnostic: Diagnostic) {
    super(diagnostic.summary);
    this.outcome = outcome;
    this.diagnostic = diagnostic;
  }
}

function failure(
  outcome: "conflict" | "invalid",
  code: "OP_PRECONDITION_FAILED" | "OP_TARGET_MISSING" | "OP_INVALID",
  summary: string,
  operationId: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new OperationFailure(
    outcome,
    createDiagnostic(code, {
      summary,
      location: { objectId: operationId },
      ...(details ? { details } : {}),
    }),
  );
}

function locate(root: MutableNode, nodeId: string): LocatedNode | undefined {
  const stack: LocatedNode[] = [{ node: root, index: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    if (entry.node.id === nodeId) return entry;
    for (
      let index = (entry.node.children?.length ?? 0) - 1;
      index >= 0;
      index -= 1
    ) {
      const child = entry.node.children?.[index];
      if (child) stack.push({ node: child, parent: entry.node, index });
    }
  }
  return undefined;
}

function requireNode(
  root: MutableNode,
  nodeId: string,
  operationId: string,
): LocatedNode {
  const located = locate(root, nodeId);
  if (!located)
    failure(
      "conflict",
      "OP_TARGET_MISSING",
      `Target node ${nodeId} does not exist.`,
      operationId,
    );
  return located;
}

function verifyRevision(
  node: MutableNode,
  expected: string,
  operationId: string,
  label: string,
): void {
  const actual = nodeRevision(node as DstarNode);
  if (actual !== expected) {
    failure(
      "conflict",
      "OP_PRECONDITION_FAILED",
      `${label} revision precondition failed.`,
      operationId,
      { expected, actual, nodeId: node.id },
    );
  }
}

function requireDirectChild(
  parent: MutableNode,
  childId: string,
  operationId: string,
): number {
  const childIndex = (parent.children ?? []).findIndex(
    (child) => child.id === childId,
  );
  if (childIndex < 0) {
    failure(
      "conflict",
      "OP_PRECONDITION_FAILED",
      `Node ${childId} is not a direct child of ${parent.id}.`,
      operationId,
    );
  }
  return childIndex;
}

function destinationIndex(
  parent: MutableNode,
  destination: { before?: string; after?: string; index?: number },
  operationId: string,
): number {
  const positioningModes = [
    destination.before,
    destination.after,
    destination.index,
  ].filter((value) => value !== undefined);
  if (positioningModes.length > 1) {
    failure(
      "invalid",
      "OP_INVALID",
      "A destination may use only before, after, or index.",
      operationId,
    );
  }
  const children = parent.children ?? [];
  if (destination.before !== undefined) {
    const index = children.findIndex(
      (child) => child.id === destination.before,
    );
    if (index < 0)
      failure(
        "conflict",
        "OP_TARGET_MISSING",
        "Destination before-sibling is missing.",
        operationId,
      );
    return index;
  }
  if (destination.after !== undefined) {
    const index = children.findIndex((child) => child.id === destination.after);
    if (index < 0)
      failure(
        "conflict",
        "OP_TARGET_MISSING",
        "Destination after-sibling is missing.",
        operationId,
      );
    return index + 1;
  }
  if (destination.index !== undefined) {
    if (
      !Number.isInteger(destination.index) ||
      destination.index < 0 ||
      destination.index > children.length
    ) {
      failure(
        "invalid",
        "OP_INVALID",
        "Destination index is outside the child array.",
        operationId,
      );
    }
    return destination.index;
  }
  return children.length;
}

function subtreeIds(node: DstarNode): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (seen.has(current.id))
      throw new Error(`Inserted subtree duplicates node ID ${current.id}`);
    seen.add(current.id);
    ids.push(current.id);
    stack.push(...(current.children ?? []));
  }
  return ids;
}

function applyOperation(
  root: MutableNode,
  operation: DstarUpdateOperation,
): void {
  switch (operation.op) {
    case "replace_text": {
      const { node } = requireNode(root, operation.target.node, operation.id);
      verifyRevision(
        node,
        operation.precondition.nodeRevision,
        operation.id,
        "Target node",
      );
      if (
        node.content?.length !== 1 ||
        node.content[0]?.type !== "text" ||
        (node.content[0].marks !== undefined &&
          node.content[0].marks.length > 0)
      ) {
        failure(
          "invalid",
          "OP_INVALID",
          "replace_text requires exactly one unmarked text inline item.",
          operation.id,
        );
      }
      const text = node.content[0].text ?? "";
      if (
        operation.range.start < 0 ||
        operation.range.start > operation.range.end ||
        operation.range.end > codePointLength(text)
      ) {
        failure(
          "invalid",
          "OP_INVALID",
          "replace_text range is outside the node text stream.",
          operation.id,
        );
      }
      const selected = codePointSlice(
        text,
        operation.range.start,
        operation.range.end,
      );
      if (
        operation.precondition.expectedText !== undefined &&
        operation.precondition.expectedText !== selected
      ) {
        failure(
          "conflict",
          "OP_PRECONDITION_FAILED",
          "replace_text expectedText does not match the selected range.",
          operation.id,
          { expected: operation.precondition.expectedText, actual: selected },
        );
      }
      node.content[0].text =
        codePointSlice(text, 0, operation.range.start) +
        operation.value +
        codePointSlice(text, operation.range.end);
      return;
    }
    case "replace_inline": {
      const { node } = requireNode(root, operation.target.node, operation.id);
      verifyRevision(
        node,
        operation.precondition.nodeRevision,
        operation.id,
        "Target node",
      );
      if (operation.precondition.expectedText !== undefined) {
        failure(
          "invalid",
          "OP_INVALID",
          "expectedText is valid only for replace_text.",
          operation.id,
        );
      }
      node.content = cloneJson(operation.value as JsonValue) as DstarInline[];
      return;
    }
    case "insert_node": {
      const { node: parent } = requireNode(
        root,
        operation.destination.parent,
        operation.id,
      );
      verifyRevision(
        parent,
        operation.destinationPrecondition.nodeRevision,
        operation.id,
        "Destination parent",
      );
      let ids: readonly string[];
      try {
        ids = subtreeIds(operation.value);
      } catch (error) {
        failure(
          "invalid",
          "OP_INVALID",
          error instanceof Error ? error.message : "Invalid inserted subtree.",
          operation.id,
        );
      }
      for (const id of ids!) {
        if (locate(root, id))
          failure(
            "invalid",
            "OP_INVALID",
            `Inserted node ID ${id} already exists.`,
            operation.id,
          );
      }
      parent.children ??= [];
      const index = destinationIndex(
        parent,
        operation.destination,
        operation.id,
      );
      parent.children.splice(
        index,
        0,
        cloneJson(operation.value as JsonValue) as MutableNode,
      );
      return;
    }
    case "delete_node": {
      const target = requireNode(root, operation.target.node, operation.id);
      if (!target.parent)
        failure(
          "invalid",
          "OP_INVALID",
          "The document root cannot be deleted.",
          operation.id,
        );
      const { node: origin } = requireNode(
        root,
        operation.origin.parent,
        operation.id,
      );
      verifyRevision(
        target.node,
        operation.precondition.nodeRevision,
        operation.id,
        "Target node",
      );
      verifyRevision(
        origin,
        operation.originPrecondition.nodeRevision,
        operation.id,
        "Origin parent",
      );
      const index = requireDirectChild(origin, target.node.id, operation.id);
      origin.children!.splice(index, 1);
      return;
    }
    case "move_node": {
      const target = requireNode(root, operation.target.node, operation.id);
      if (!target.parent)
        failure(
          "invalid",
          "OP_INVALID",
          "The document root cannot be moved.",
          operation.id,
        );
      const { node: origin } = requireNode(
        root,
        operation.origin.parent,
        operation.id,
      );
      const { node: destination } = requireNode(
        root,
        operation.destination.parent,
        operation.id,
      );
      if (locate(target.node, destination.id)) {
        failure(
          "invalid",
          "OP_INVALID",
          "A node cannot move inside its own subtree.",
          operation.id,
        );
      }
      if (
        operation.destination.before === target.node.id ||
        operation.destination.after === target.node.id
      ) {
        failure(
          "invalid",
          "OP_INVALID",
          "A move destination cannot reference the moving node.",
          operation.id,
        );
      }
      verifyRevision(
        target.node,
        operation.precondition.nodeRevision,
        operation.id,
        "Target node",
      );
      verifyRevision(
        origin,
        operation.originPrecondition.nodeRevision,
        operation.id,
        "Origin parent",
      );
      verifyRevision(
        destination,
        operation.destinationPrecondition.nodeRevision,
        operation.id,
        "Destination parent",
      );
      if (
        origin.id === destination.id &&
        operation.originPrecondition.nodeRevision !==
          operation.destinationPrecondition.nodeRevision
      ) {
        failure(
          "invalid",
          "OP_INVALID",
          "Same-parent move preconditions must be identical.",
          operation.id,
        );
      }
      const originIndex = requireDirectChild(
        origin,
        target.node.id,
        operation.id,
      );
      origin.children!.splice(originIndex, 1);
      destination.children ??= [];
      const targetIndex = destinationIndex(
        destination,
        operation.destination,
        operation.id,
      );
      destination.children.splice(targetIndex, 0, target.node);
      return;
    }
    case "set_attrs": {
      const { node } = requireNode(root, operation.target.node, operation.id);
      verifyRevision(
        node,
        operation.precondition.nodeRevision,
        operation.id,
        "Target node",
      );
      if (operation.precondition.expectedText !== undefined) {
        failure(
          "invalid",
          "OP_INVALID",
          "expectedText is valid only for replace_text.",
          operation.id,
        );
      }
      if (operation.value === null) delete node.attrs;
      else
        node.attrs = cloneJson(operation.value as JsonValue) as Record<
          string,
          unknown
        >;
      return;
    }
  }
}

function ownSemanticValue(node: DstarNode): JsonValue {
  return {
    type: node.type,
    ...(node.attrs === undefined ? {} : { attrs: node.attrs }),
    ...(node.content === undefined ? {} : { content: node.content }),
  } as JsonValue;
}

export function semanticDiff(
  before: DstarDocument,
  after: DstarDocument,
): SemanticDiff {
  const beforeIndex = new DocumentIndex(before);
  const afterIndex = new DocumentIndex(after);
  const insertedNodeIds = afterIndex.readingOrder.filter(
    (id) => !beforeIndex.nodes.has(id),
  );
  const deletedNodeIds = beforeIndex.readingOrder.filter(
    (id) => !afterIndex.nodes.has(id),
  );
  const movedNodes: NodeMove[] = [];
  const modifiedNodes: NodeModification[] = [];

  for (const nodeId of beforeIndex.readingOrder) {
    const beforeNode = beforeIndex.get(nodeId);
    const afterNode = afterIndex.get(nodeId);
    if (!beforeNode || !afterNode) continue;
    const beforeParentId = beforeIndex.parentIds.get(nodeId);
    const afterParentId = afterIndex.parentIds.get(nodeId);
    if (beforeParentId !== undefined && afterParentId !== undefined) {
      const beforePosition = beforeIndex
        .children(beforeParentId)
        .findIndex((node) => node.id === nodeId);
      const afterPosition = afterIndex
        .children(afterParentId)
        .findIndex((node) => node.id === nodeId);
      if (
        beforeParentId !== afterParentId ||
        beforePosition !== afterPosition
      ) {
        movedNodes.push({
          nodeId,
          fromParentId: beforeParentId,
          toParentId: afterParentId,
          fromIndex: beforePosition,
          toIndex: afterPosition,
        });
      }
    }
    if (
      canonicalize(ownSemanticValue(beforeNode)) !==
      canonicalize(ownSemanticValue(afterNode))
    ) {
      modifiedNodes.push({
        nodeId,
        beforeText: nodeTextStream(beforeNode),
        afterText: nodeTextStream(afterNode),
        attrsChanged:
          canonicalize((beforeNode.attrs ?? null) as JsonValue) !==
          canonicalize((afterNode.attrs ?? null) as JsonValue),
        inlineChanged:
          canonicalize((beforeNode.content ?? null) as JsonValue) !==
          canonicalize((afterNode.content ?? null) as JsonValue),
      });
    }
  }

  return Object.freeze({
    insertedNodeIds: Object.freeze(insertedNodeIds),
    deletedNodeIds: Object.freeze(deletedNodeIds),
    movedNodes: Object.freeze(movedNodes),
    modifiedNodes: Object.freeze(modifiedNodes),
  });
}

export function simulateOperations(
  document: DstarDocument,
  operations: readonly DstarUpdateOperation[],
  profiles: readonly string[] = ["dstar:base"],
): OperationSimulationResult {
  const working = cloneJson(document as JsonValue) as MutableNode;
  const operationResults: OperationSimulation[] = [];
  const diagnostics: Diagnostic[] = [];
  let failed = false;

  for (const operation of operations) {
    if (failed) {
      operationResults.push({
        operationId: operation.id,
        operation: operation.op,
        outcome: "not-evaluated",
        diagnostics: Object.freeze([]),
      });
      continue;
    }
    try {
      applyOperation(working, operation);
      const resultDiagnostics = [
        ...validateStructure("document", working).diagnostics,
        ...validateBaseProfile(working as DstarDocument, profiles),
      ].filter((diagnostic) => diagnostic.severity === "error");
      if (resultDiagnostics.length > 0) {
        throw new OperationFailure("invalid", resultDiagnostics[0]!);
      }
      operationResults.push({
        operationId: operation.id,
        operation: operation.op,
        outcome: "applied",
        diagnostics: Object.freeze([]),
      });
    } catch (error) {
      failed = true;
      const operationFailure =
        error instanceof OperationFailure
          ? error
          : new OperationFailure(
              "invalid",
              createDiagnostic("OP_INVALID", {
                summary:
                  error instanceof Error ? error.message : "Operation failed.",
                location: { objectId: operation.id },
              }),
            );
      diagnostics.push(operationFailure.diagnostic);
      operationResults.push({
        operationId: operation.id,
        operation: operation.op,
        outcome: operationFailure.outcome,
        diagnostics: Object.freeze([operationFailure.diagnostic]),
      });
    }
  }

  if (failed) {
    return Object.freeze({
      applicable: false,
      operations: Object.freeze(operationResults),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const result = deepFreezeJson(working as JsonValue) as DstarDocument;
  return Object.freeze({
    applicable: true,
    result,
    resultRevision: documentRevision(result),
    operations: Object.freeze(operationResults),
    semanticDiff: semanticDiff(document, result),
    diagnostics: Object.freeze(diagnostics),
  });
}
