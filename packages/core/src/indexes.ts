import { cloneJson, deepFreezeJson } from "./json.js";
import type {
  DstarAnnotation,
  DstarChange,
  DstarDocument,
  DstarNode,
  DstarProjection,
  InMemoryPackage,
  JsonValue,
} from "./protocol.js";

export class DuplicateIdError extends Error {
  readonly id: string;
  readonly scope: string;

  constructor(id: string, scope: string) {
    super(`Duplicate identifier ${id} in ${scope}`);
    this.name = "DuplicateIdError";
    this.id = id;
    this.scope = scope;
  }
}

function immutableDocument(document: DstarDocument): DstarDocument {
  return deepFreezeJson(cloneJson(document as JsonValue)) as DstarDocument;
}

function insertUnique<T>(
  map: Map<string, T>,
  id: string,
  value: T,
  scope: string,
): void {
  if (map.has(id)) throw new DuplicateIdError(id, scope);
  map.set(id, value);
}

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;

  constructor(entries: ReadonlyMap<K, V>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: K): V | undefined {
    return this.#map.get(key);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#map.entries();
  }

  keys(): MapIterator<K> {
    return this.#map.keys();
  }

  values(): MapIterator<V> {
    return this.#map.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.#map)
      callbackfn.call(thisArg, value, key, this);
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

function immutableMap<K, V>(map: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return new ImmutableMapView(map);
}

function immutableProtocol<T>(value: T): T {
  return deepFreezeJson(cloneJson(value as JsonValue)) as T;
}

export class DocumentIndex {
  readonly document: DstarDocument;
  readonly nodes: ReadonlyMap<string, DstarNode>;
  readonly parentIds: ReadonlyMap<string, string | undefined>;
  readonly readingOrder: readonly string[];
  readonly orderById: ReadonlyMap<string, number>;
  readonly #childrenByParent: ReadonlyMap<string, readonly string[]>;

  constructor(input: DstarDocument) {
    this.document = immutableDocument(input);
    const nodes = new Map<string, DstarNode>();
    const parentIds = new Map<string, string | undefined>();
    const childrenByParent = new Map<string, readonly string[]>();
    const readingOrder: string[] = [];
    const stack: { node: DstarNode; parentId?: string }[] = [
      { node: this.document },
    ];

    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) break;
      insertUnique(nodes, entry.node.id, entry.node, "document nodes");
      parentIds.set(entry.node.id, entry.parentId);
      readingOrder.push(entry.node.id);
      const children = Object.freeze(
        (entry.node.children ?? []).map((child) => child.id),
      );
      childrenByParent.set(entry.node.id, children);
      for (
        let index = (entry.node.children?.length ?? 0) - 1;
        index >= 0;
        index -= 1
      ) {
        const child = entry.node.children?.[index];
        if (child) stack.push({ node: child, parentId: entry.node.id });
      }
    }

    this.nodes = immutableMap(nodes);
    this.parentIds = immutableMap(parentIds);
    this.readingOrder = Object.freeze(readingOrder);
    this.orderById = immutableMap(
      new Map(readingOrder.map((id, index) => [id, index])),
    );
    this.#childrenByParent = childrenByParent;
    Object.freeze(this);
  }

  get(nodeId: string): DstarNode | undefined {
    return this.nodes.get(nodeId);
  }

  parent(nodeId: string): DstarNode | undefined {
    const parentId = this.parentIds.get(nodeId);
    return parentId === undefined ? undefined : this.nodes.get(parentId);
  }

  children(nodeId: string): readonly DstarNode[] {
    return Object.freeze(
      (this.#childrenByParent.get(nodeId) ?? []).flatMap((id) => {
        const child = this.nodes.get(id);
        return child ? [child] : [];
      }),
    );
  }

  ancestors(nodeId: string): readonly DstarNode[] {
    const ancestors: DstarNode[] = [];
    let parentId = this.parentIds.get(nodeId);
    while (parentId !== undefined) {
      const parent = this.nodes.get(parentId);
      if (!parent) break;
      ancestors.push(parent);
      parentId = this.parentIds.get(parentId);
    }
    return Object.freeze(ancestors);
  }

  isDescendant(candidateId: string, ancestorId: string): boolean {
    let parentId = this.parentIds.get(candidateId);
    while (parentId !== undefined) {
      if (parentId === ancestorId) return true;
      parentId = this.parentIds.get(parentId);
    }
    return false;
  }
}

export class PackageIndex {
  readonly document: DocumentIndex;
  readonly annotations: ReadonlyMap<string, DstarAnnotation>;
  readonly changes: ReadonlyMap<string, DstarChange>;
  readonly projections: ReadonlyMap<string, DstarProjection>;
  readonly sources: ReadonlyMap<string, unknown>;
  readonly replies: ReadonlyMap<
    string,
    { annotationId: string; reply: unknown }
  >;

  constructor(pkg: InMemoryPackage) {
    this.document = new DocumentIndex(pkg.document);
    const annotations = new Map<string, DstarAnnotation>();
    const changes = new Map<string, DstarChange>();
    const projections = new Map<string, DstarProjection>();
    const sources = new Map<string, unknown>();
    const replies = new Map<string, { annotationId: string; reply: unknown }>();

    for (const annotation of pkg.annotations) {
      const immutableAnnotation = immutableProtocol(annotation);
      insertUnique(
        annotations,
        annotation.id,
        immutableAnnotation,
        "annotations",
      );
      for (const reply of immutableAnnotation.replies ?? []) {
        insertUnique(
          replies,
          `${annotation.id}\u0000${reply.id}`,
          Object.freeze({ annotationId: annotation.id, reply }),
          `replies in ${annotation.id}`,
        );
      }
    }
    for (const change of pkg.changes)
      insertUnique(changes, change.id, immutableProtocol(change), "changes");
    for (const projection of pkg.projections?.projections ?? []) {
      insertUnique(
        projections,
        projection.id,
        immutableProtocol(projection),
        "projections",
      );
    }
    for (const source of pkg.sources?.sources ?? []) {
      insertUnique(sources, source.id, immutableProtocol(source), "sources");
    }

    this.annotations = immutableMap(annotations);
    this.changes = immutableMap(changes);
    this.projections = immutableMap(projections);
    this.sources = immutableMap(sources);
    this.replies = immutableMap(replies);
    Object.freeze(this);
  }

  getReply(
    annotationId: string,
    replyId: string,
  ): { annotationId: string; reply: unknown } | undefined {
    return this.replies.get(`${annotationId}\u0000${replyId}`);
  }
}

export function nodeTextStream(node: DstarNode): string {
  return (node.content ?? [])
    .map((inline) => (inline.type === "text" ? (inline.text ?? "") : ""))
    .join("");
}
