import {
  DocumentIndex,
  buildGenesisProposal,
  buildUpdateProposal,
  documentRevision,
  nodeTextStream,
  parseIJson,
  revisionOf,
  sha256Hex,
  simulateUpdateChange,
  validateBaseProfile,
  type DstarActor,
  type DstarChange,
  type DstarDocument,
  type DstarUpdateOperation,
  type JsonValue,
} from "@dstar/core";
import {
  PackageCommandError,
  PackageCommands,
  PackageOpenError,
  PackageRepository,
  PackageTransactionError,
  stageGenesisProposal,
  type GenesisDraft,
  type PackageSnapshot,
} from "@dstar/node";
import {
  unwatchFile,
  watch,
  watchFile,
  type FSWatcher,
  type Stats,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MCP_TOOL_NAMES = Object.freeze([
  "get_manifest",
  "list_comments",
  "get_node",
  "search_document",
  "get_annotation",
  "get_source",
  "simulate_update",
  "submit_proposal",
  "reply_comment",
  "submit_genesis",
] as const);

export interface McpBudgets {
  readonly maxCalls: number;
  readonly maxReadBytes: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_MCP_BUDGETS: McpBudgets = Object.freeze({
  maxCalls: 128,
  maxReadBytes: 2 * 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024,
});

export const DSTAR_RESOURCE_URI_TEMPLATES = Object.freeze([
  "dstar://document/manifest",
  "dstar://document/node/{nodeId}",
  "dstar://annotation/{annotationId}",
  "dstar://source/{sourceId}",
  "dstar://projection/{projectionId}/mapping",
  "dstar://genesis/request",
] as const);

export interface DstarMcpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: "application/json";
}

export interface DstarMcpResourceContent {
  readonly uri: string;
  readonly mimeType: "application/json";
  readonly text: string;
}

export interface DstarMcpResourceChange {
  readonly uris: readonly string[];
  readonly listChanged: boolean;
}

interface BrokerBaseOptions {
  readonly principalId: string;
  readonly expiresAt?: string;
  readonly budgets?: Partial<McpBudgets>;
  readonly now?: () => Date;
}

export interface DocumentBrokerOptions extends BrokerBaseOptions {
  readonly mode: "document";
  readonly packageRoot: string;
  readonly runtimeRoot: string;
}

export interface GenesisBrokerOptions extends BrokerBaseOptions {
  readonly mode: "genesis";
  readonly draftRoot: string;
}

export type BrokerOptions = DocumentBrokerOptions | GenesisBrokerOptions;

export class McpBrokerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly diagnosticCodes: readonly string[];

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; diagnosticCodes?: readonly string[] } = {},
  ) {
    super(message);
    this.name = "McpBrokerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.diagnosticCodes = Object.freeze([...(options.diagnosticCodes ?? [])]);
  }
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new McpBrokerError("INVALID_ARGUMENT", `${name} must be positive`);
  return value;
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new McpBrokerError(
      "INVALID_ARGUMENT",
      `${name} must contain strings`,
    );
  return value;
}

function portableId(prefix: string, seed: string): string {
  return `${prefix}_${sha256Hex(new TextEncoder().encode(seed)).slice(0, 24)}`;
}

function resourceUri(scope: string, id?: string, suffix = ""): string {
  return `dstar://${scope}${id === undefined ? "" : `/${encodeURIComponent(id)}`}${suffix}`;
}

function descriptor(
  uri: string,
  name: string,
  title: string,
  description: string,
): DstarMcpResourceDescriptor {
  return {
    uri,
    name,
    title,
    description,
    mimeType: "application/json",
  };
}

function samePortableValue(left: unknown, right: unknown): boolean {
  return revisionOf(left as JsonValue) === revisionOf(right as JsonValue);
}

async function readOptionalChange(
  path: string,
): Promise<DstarChange | undefined> {
  try {
    return parseIJson(await readFile(path)).value as unknown as DstarChange;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function packageError(error: unknown): McpBrokerError {
  if (
    error instanceof PackageOpenError ||
    error instanceof PackageTransactionError ||
    error instanceof PackageCommandError
  ) {
    return new McpBrokerError(
      "DSTAR_VALIDATION_FAILED",
      "DSTAR validation rejected the operation",
      {
        retryable: error.diagnostics.some(
          (item) => item.code === "TXN_SNAPSHOT_STALE",
        ),
        diagnosticCodes: error.diagnostics.map((item) => item.code),
      },
    );
  }
  if (error instanceof McpBrokerError) return error;
  return new McpBrokerError("INTERNAL", "The scoped DSTAR operation failed");
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new McpBrokerError("CANCELLED", "The tool call was cancelled", {
      retryable: true,
    });
}

async function readDraft(root: string): Promise<GenesisDraft> {
  const value = parseIJson(await readFile(join(root, "draft.json")))
    .value as unknown as GenesisDraft;
  if (
    value.format !== "dstar-genesis-draft/0.1" ||
    value.request.actor.type !== "human"
  )
    throw new McpBrokerError("DRAFT_INVALID", "The fixed draft is invalid");
  return value;
}

export class DstarMcpBroker {
  readonly mode: "document" | "genesis";
  readonly principalId: string;
  readonly expiresAt: string;
  readonly budgets: McpBudgets;
  readonly #now: () => Date;
  readonly #packageRoot?: string;
  readonly #draftRoot?: string;
  readonly #repository?: PackageRepository;
  #resourcePollPaths: readonly string[] = [];
  #remainingCalls: number;
  #remainingReadBytes: number;
  #remainingOutputBytes: number;

  private constructor(options: BrokerOptions) {
    this.mode = options.mode;
    this.principalId = options.principalId;
    this.#now = options.now ?? (() => new Date());
    this.expiresAt =
      options.expiresAt ??
      new Date(this.#now().getTime() + 8 * 60 * 60 * 1_000).toISOString();
    this.budgets = Object.freeze({
      ...DEFAULT_MCP_BUDGETS,
      ...options.budgets,
    });
    positiveInteger(this.budgets.maxCalls, "maxCalls");
    positiveInteger(this.budgets.maxReadBytes, "maxReadBytes");
    positiveInteger(this.budgets.maxOutputBytes, "maxOutputBytes");
    if (!/^[A-Za-z][A-Za-z0-9._:-]{0,254}$/.test(this.principalId))
      throw new McpBrokerError(
        "INVALID_PRINCIPAL",
        "The human principal ID is invalid",
      );
    if (options.mode === "document") {
      this.#packageRoot = resolve(options.packageRoot);
      this.#repository = new PackageRepository(resolve(options.runtimeRoot));
    } else this.#draftRoot = resolve(options.draftRoot);
    this.#remainingCalls = this.budgets.maxCalls;
    this.#remainingReadBytes = this.budgets.maxReadBytes;
    this.#remainingOutputBytes = this.budgets.maxOutputBytes;
  }

  static async create(options: BrokerOptions): Promise<DstarMcpBroker> {
    const broker = new DstarMcpBroker(options);
    if (options.mode === "document") {
      const snapshot = await broker.#snapshot();
      if (snapshot.inventory.length <= 256)
        broker.#resourcePollPaths = Object.freeze(
          snapshot.inventory.map((item) =>
            join(broker.#packageRoot!, item.path),
          ),
        );
    } else {
      await readDraft(broker.#draftRoot!);
      broker.#resourcePollPaths = Object.freeze([
        join(broker.#draftRoot!, "draft.json"),
        join(broker.#draftRoot!, "proposal.json"),
      ]);
    }
    return broker;
  }

  get resourceSubscriptionsAvailable(): boolean {
    return this.#resourcePollPaths.length > 0;
  }

  #principal(): DstarActor {
    return { type: "human", id: this.principalId };
  }

  #begin(signal?: AbortSignal): void {
    checkAbort(signal);
    if (this.#now().getTime() >= Date.parse(this.expiresAt))
      throw new McpBrokerError(
        "CAPABILITY_EXPIRED",
        "The DSTAR session expired",
      );
    if (this.#remainingCalls <= 0)
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The session call budget is exhausted",
      );
    this.#remainingCalls -= 1;
  }

  #finish(value: JsonValue, readBytes = 0): JsonValue {
    const outputBytes = byteLength(value);
    if (
      readBytes > this.#remainingReadBytes ||
      outputBytes > this.#remainingOutputBytes
    )
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The session byte budget is exhausted",
      );
    this.#remainingReadBytes -= readBytes;
    this.#remainingOutputBytes -= outputBytes;
    return value;
  }

  #remaining(): JsonValue {
    return {
      calls: this.#remainingCalls,
      readBytes: this.#remainingReadBytes,
      outputBytes: this.#remainingOutputBytes,
    };
  }

  async #snapshot(): Promise<PackageSnapshot> {
    if (this.mode !== "document")
      throw new McpBrokerError(
        "MODE_DENIED",
        "This operation requires document mode",
      );
    return this.#repository!.open(this.#packageRoot!);
  }

  async listResources(): Promise<readonly DstarMcpResourceDescriptor[]> {
    if (this.mode === "genesis") {
      const draft = await readDraft(this.#draftRoot!);
      return Object.freeze([
        descriptor(
          "dstar://genesis/request",
          "genesis-request",
          draft.request.title,
          "Fixed document creation request.",
        ),
        ...(draft.request.sources?.sources.map((source) =>
          descriptor(
            resourceUri("source", source.id),
            `source-${source.id}`,
            source.title,
            "Source metadata admitted to this draft.",
          ),
        ) ?? []),
      ]);
    }
    const snapshot = await this.#snapshot();
    const index = new DocumentIndex(snapshot.document);
    return Object.freeze([
      descriptor(
        "dstar://document/manifest",
        "document-manifest",
        snapshot.manifest.title,
        "Manifest for the fixed document.",
      ),
      ...index.readingOrder.map((id) =>
        descriptor(
          resourceUri("document/node", id),
          `node-${id}`,
          `Node ${id}`,
          "Canonical node context.",
        ),
      ),
      ...snapshot.annotations.map((item) =>
        descriptor(
          resourceUri("annotation", item.id),
          `annotation-${item.id}`,
          `Annotation ${item.id}`,
          "Portable annotation thread.",
        ),
      ),
      ...(snapshot.sources?.sources.map((item) =>
        descriptor(
          resourceUri("source", item.id),
          `source-${item.id}`,
          item.title,
          "Portable source metadata.",
        ),
      ) ?? []),
      ...(snapshot.projections?.projections.map((item) =>
        descriptor(
          resourceUri("projection", item.id, "/mapping"),
          `projection-${item.id}-mapping`,
          `Projection ${item.id}`,
          "Projection mapping metadata.",
        ),
      ) ?? []),
    ]);
  }

  async readResource(
    rawUri: string,
    signal?: AbortSignal,
  ): Promise<DstarMcpResourceContent> {
    this.#begin(signal);
    if (!(await this.listResources()).some((item) => item.uri === rawUri))
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The resource is outside this document scope",
      );
    let value: JsonValue;
    if (this.mode === "genesis") {
      const draft = await readDraft(this.#draftRoot!);
      const source = draft.request.sources?.sources.find(
        (item) => resourceUri("source", item.id) === rawUri,
      );
      if (rawUri === "dstar://genesis/request")
        value = asJson({ request: draft.request });
      else if (source) value = asJson({ source });
      else throw new McpBrokerError("NOT_FOUND", "Resource not found");
    } else {
      const snapshot = await this.#snapshot();
      const index = new DocumentIndex(snapshot.document);
      const nodeId = index.readingOrder.find(
        (id) => resourceUri("document/node", id) === rawUri,
      );
      const annotation = snapshot.annotations.find(
        (item) => resourceUri("annotation", item.id) === rawUri,
      );
      const source = snapshot.sources?.sources.find(
        (item) => resourceUri("source", item.id) === rawUri,
      );
      const projection = snapshot.projections?.projections.find(
        (item) => resourceUri("projection", item.id, "/mapping") === rawUri,
      );
      if (rawUri === "dstar://document/manifest")
        value = asJson({ manifest: snapshot.manifest });
      else if (nodeId)
        value = asJson({
          node: index.get(nodeId),
          ancestorIds: index.ancestors(nodeId).map((item) => item.id),
          documentRevision: snapshot.manifest.revision,
        });
      else if (annotation) value = asJson({ annotation });
      else if (source) value = asJson({ source });
      else if (projection) value = asJson({ projection });
      else throw new McpBrokerError("NOT_FOUND", "Resource not found");
    }
    const text = JSON.stringify(this.#finish(value, byteLength(value)));
    return { uri: rawUri, mimeType: "application/json", text };
  }

  watchResources(
    listener: (change: DstarMcpResourceChange) => void,
  ): () => void {
    if (!this.resourceSubscriptionsAvailable) return () => undefined;
    const target =
      this.mode === "document" ? this.#packageRoot! : this.#draftRoot!;
    let watcher: FSWatcher | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pollers: Array<{
      path: string;
      listener: (current: Stats, previous: Stats) => void;
    }> = [];
    const changedPaths = new Set<string>();
    const changedUris = async (): Promise<readonly string[]> => {
      const resources = await this.listResources();
      const uris = new Set<string>();
      for (const path of changedPaths) {
        const normalized = path.replaceAll("\\", "/");
        if (normalized === "manifest.json")
          uris.add("dstar://document/manifest");
        else if (normalized === "draft.json")
          uris.add("dstar://genesis/request");
        else if (normalized === "document.json") {
          for (const item of resources)
            if (item.uri.startsWith("dstar://document/node/"))
              uris.add(item.uri);
        } else if (
          normalized.startsWith("annotations/") &&
          normalized.endsWith(".json")
        ) {
          const id = normalized.slice("annotations/".length, -".json".length);
          uris.add(resourceUri("annotation", id));
        } else if (normalized === "sources.json") {
          for (const item of resources)
            if (item.uri.startsWith("dstar://source/")) uris.add(item.uri);
        } else if (normalized === "projections/index.json") {
          for (const item of resources)
            if (item.uri.startsWith("dstar://projection/")) uris.add(item.uri);
        }
      }
      changedPaths.clear();
      return [...uris].sort();
    };
    const schedule = (filename?: string) => {
      if (filename) changedPaths.add(filename);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void changedUris()
          .then((uris) => listener({ uris, listChanged: true }))
          .catch(() => listener({ uris: [], listChanged: true }));
      }, 50);
      timer.unref?.();
    };
    for (const path of this.#resourcePollPaths) {
      const pollListener = (current: Stats, previous: Stats) => {
        if (
          current.mtimeMs !== previous.mtimeMs ||
          current.size !== previous.size
        )
          schedule(path.slice(target.length + 1));
      };
      watchFile(path, { interval: 200, persistent: false }, pollListener);
      pollers.push({ path, listener: pollListener });
    }
    try {
      watcher = watch(
        target,
        { recursive: true, persistent: false },
        (_event, filename) => {
          schedule(filename?.toString());
        },
      );
      watcher.on("error", () => watcher?.close());
      watcher.unref();
    } catch {
      // Polling remains active when native recursive watching is unavailable.
    }
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
      for (const poller of pollers) unwatchFile(poller.path, poller.listener);
    };
  }

  async getManifest(signal?: AbortSignal): Promise<JsonValue> {
    this.#begin(signal);
    if (this.mode === "genesis") {
      const draft = await readDraft(this.#draftRoot!);
      return this.#finish(
        asJson({
          mode: "genesis",
          request: draft.request,
          remaining: this.#remaining(),
        }),
      );
    }
    const snapshot = await this.#snapshot();
    return this.#finish(
      asJson({
        mode: "document",
        snapshotId: snapshot.snapshotId,
        manifest: snapshot.manifest,
        remaining: this.#remaining(),
      }),
    );
  }

  async listComments(
    assignedToMe = false,
    openOnly = false,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    const snapshot = await this.#snapshot();
    const comments = snapshot.annotations
      .filter((item) => !assignedToMe || item.assignee?.id === this.principalId)
      .filter((item) => !openOnly || item.status === "open")
      .map((item) => ({
        id: item.id,
        purpose: item.purpose,
        status: item.status,
        assignee: item.assignee ?? null,
        target: item.target,
        createdAt: item.createdAt,
      }));
    return this.#finish(
      asJson({
        comments,
        snapshotId: snapshot.snapshotId,
        remaining: this.#remaining(),
      }),
      byteLength(comments),
    );
  }

  async getNode(
    nodeId: string,
    neighborCount = 1,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    positiveInteger(neighborCount, "neighborCount");
    if (neighborCount > 5)
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "neighborCount must not exceed 5",
      );
    const snapshot = await this.#snapshot();
    const index = new DocumentIndex(snapshot.document);
    const node = index.get(nodeId);
    if (!node) throw new McpBrokerError("NOT_FOUND", "The node does not exist");
    const position = index.orderById.get(nodeId)!;
    const neighbors = index.readingOrder
      .slice(
        Math.max(0, position - neighborCount),
        position + neighborCount + 1,
      )
      .filter((id) => id !== nodeId)
      .map((id) => ({
        id,
        type: index.get(id)!.type,
        text: nodeTextStream(index.get(id)!),
      }));
    const value = asJson({
      node,
      ancestorIds: index.ancestors(nodeId).map((item) => item.id),
      neighbors,
      snapshotId: snapshot.snapshotId,
      documentRevision: snapshot.manifest.revision,
      remaining: this.#remaining(),
    });
    return this.#finish(value, byteLength(value));
  }

  async searchDocument(
    query: string,
    limit = 10,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    if (!query.trim())
      throw new McpBrokerError("INVALID_ARGUMENT", "query must not be empty");
    positiveInteger(limit, "limit");
    if (limit > 50)
      throw new McpBrokerError("INVALID_ARGUMENT", "limit must not exceed 50");
    const snapshot = await this.#snapshot();
    const index = new DocumentIndex(snapshot.document);
    const needle = query.toLocaleLowerCase("en-US");
    const results = index.readingOrder
      .flatMap((id, order) => {
        const node = index.get(id)!;
        const text = nodeTextStream(node);
        const at = text.toLocaleLowerCase("en-US").indexOf(needle);
        return at < 0
          ? []
          : [
              {
                nodeId: id,
                type: node.type,
                order,
                excerpt: text.slice(Math.max(0, at - 60), at + 120),
              },
            ];
      })
      .slice(0, limit);
    return this.#finish(
      asJson({
        query,
        results,
        snapshotId: snapshot.snapshotId,
        remaining: this.#remaining(),
      }),
      byteLength(results),
    );
  }

  async getAnnotation(
    annotationId: string,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    const snapshot = await this.#snapshot();
    const annotation = snapshot.annotations.find(
      (item) => item.id === annotationId,
    );
    if (!annotation)
      throw new McpBrokerError("NOT_FOUND", "The annotation does not exist");
    return this.#finish(
      asJson({
        annotation,
        snapshotId: snapshot.snapshotId,
        remaining: this.#remaining(),
      }),
      byteLength(annotation),
    );
  }

  async getSource(
    sourceId: string,
    maxBytes = 64 * 1024,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    positiveInteger(maxBytes, "maxBytes");
    if (maxBytes > 256 * 1024)
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "maxBytes must not exceed 262144",
      );
    const sources =
      this.mode === "document"
        ? (await this.#snapshot()).sources
        : (await readDraft(this.#draftRoot!)).request.sources;
    const source = sources?.sources.find((item) => item.id === sourceId);
    if (!source)
      throw new McpBrokerError("NOT_FOUND", "The source does not exist");
    return this.#finish(
      asJson({ source, remaining: this.#remaining() }),
      Math.min(byteLength(source), maxBytes),
    );
  }

  #proposal(input: {
    idempotencyKey: string;
    baseChange: string;
    baseRevision: string;
    operations: readonly unknown[];
    motivatedBy?: unknown;
    sourceIds?: unknown;
  }): DstarChange {
    if (!input.idempotencyKey)
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "idempotencyKey must not be empty",
      );
    return buildUpdateProposal({
      id: portableId("change", `${this.principalId}\0${input.idempotencyKey}`),
      idempotencyKey: input.idempotencyKey,
      author: this.#principal(),
      baseChange: input.baseChange,
      baseRevision: input.baseRevision,
      operations: input.operations as readonly DstarUpdateOperation[],
      createdAt: this.#now().toISOString(),
      motivatedBy: stringArray(input.motivatedBy ?? [], "motivatedBy"),
      sources: stringArray(input.sourceIds ?? [], "sourceIds"),
    });
  }

  async simulateUpdate(
    input: {
      idempotencyKey?: string;
      baseChange: string;
      baseRevision: string;
      operations: readonly unknown[];
      motivatedBy?: unknown;
      sourceIds?: unknown;
    },
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    const snapshot = await this.#snapshot();
    const proposal = this.#proposal({
      ...input,
      idempotencyKey: input.idempotencyKey ?? "simulation",
    });
    const simulation = simulateUpdateChange(
      { ...snapshot, changes: [...snapshot.changes, proposal] },
      proposal.id,
    );
    return this.#finish(
      asJson({
        proposal,
        simulation,
        snapshotId: snapshot.snapshotId,
        remaining: this.#remaining(),
      }),
      byteLength(input),
    );
  }

  async submitProposal(
    input: {
      idempotencyKey: string;
      baseChange: string;
      baseRevision: string;
      operations: readonly unknown[];
      motivatedBy?: unknown;
      sourceIds?: unknown;
    },
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    const snapshot = await this.#snapshot();
    const id = portableId(
      "change",
      `${this.principalId}\0${input.idempotencyKey}`,
    );
    const existing = snapshot.changes.find((item) => item.id === id);
    const proposal = this.#proposal(input);
    const stableProposal = existing
      ? { ...proposal, createdAt: existing.createdAt }
      : proposal;
    if (existing && !samePortableValue(existing, stableProposal))
      throw new McpBrokerError(
        "IDEMPOTENCY_MISMATCH",
        "The idempotency key was already used with different proposal input",
      );
    const simulation = simulateUpdateChange(
      existing
        ? snapshot
        : { ...snapshot, changes: [...snapshot.changes, stableProposal] },
      stableProposal.id,
    );
    if (
      simulation.applicability === "invalid" ||
      simulation.applicability === "local-conflict"
    )
      throw new McpBrokerError(
        "PROPOSAL_INVALID",
        "The proposal does not simulate cleanly",
        { diagnosticCodes: simulation.diagnostics.map((item) => item.code) },
      );
    if (existing)
      return this.#finish(
        asJson({
          status: "pending-human-decision",
          changeId: existing.id,
          simulation,
          snapshotId: snapshot.snapshotId,
          canonicalRevision: snapshot.manifest.revision,
          remaining: this.#remaining(),
        }),
        byteLength(input),
      );
    try {
      const result = await new PackageCommands(
        this.#repository!,
      ).recordProposal(
        snapshot,
        { change: stableProposal },
        {
          expectedSnapshotId: snapshot.snapshotId,
          idempotencyKey: `mcp-proposal:${this.principalId}:${input.idempotencyKey}`,
        },
      );
      return this.#finish(
        asJson({
          status: "pending-human-decision",
          changeId: stableProposal.id,
          simulation,
          snapshotId: result.snapshotId,
          canonicalRevision: result.manifest.revision,
          remaining: this.#remaining(),
        }),
        byteLength(input),
      );
    } catch (error) {
      throw packageError(error);
    }
  }

  async replyComment(
    input: { annotationId: string; body: string; idempotencyKey: string },
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    if (!input.body.trim() || !input.idempotencyKey)
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "body and idempotencyKey are required",
      );
    const snapshot = await this.#snapshot();
    const annotation = snapshot.annotations.find(
      (item) => item.id === input.annotationId,
    );
    if (!annotation)
      throw new McpBrokerError("NOT_FOUND", "The annotation does not exist");
    const id = portableId(
      "reply",
      `${this.principalId}\0${input.idempotencyKey}`,
    );
    const existing = annotation.replies?.find((item) => item.id === id);
    const reply = {
      id,
      body: input.body,
      author: this.#principal(),
      createdAt: existing?.createdAt ?? this.#now().toISOString(),
    };
    if (existing && !samePortableValue(existing, reply))
      throw new McpBrokerError(
        "IDEMPOTENCY_MISMATCH",
        "The idempotency key was already used with different reply input",
      );
    if (existing)
      return this.#finish(
        asJson({
          replyId: existing.id,
          annotationId: input.annotationId,
          snapshotId: snapshot.snapshotId,
          remaining: this.#remaining(),
        }),
        byteLength(input),
      );
    try {
      const result = await new PackageCommands(
        this.#repository!,
      ).recordProposal(
        snapshot,
        { annotationId: input.annotationId, reply },
        {
          expectedSnapshotId: snapshot.snapshotId,
          idempotencyKey: `mcp-reply:${this.principalId}:${input.idempotencyKey}`,
        },
      );
      return this.#finish(
        asJson({
          replyId: reply.id,
          annotationId: input.annotationId,
          snapshotId: result.snapshotId,
          remaining: this.#remaining(),
        }),
        byteLength(input),
      );
    } catch (error) {
      throw packageError(error);
    }
  }

  async submitGenesis(
    input: { idempotencyKey: string; document: unknown; sourceIds?: unknown },
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    this.#begin(signal);
    if (this.mode !== "genesis")
      throw new McpBrokerError(
        "MODE_DENIED",
        "This operation requires genesis mode",
      );
    const draft = await readDraft(this.#draftRoot!);
    if (draft.request.actor.id !== this.principalId)
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The draft belongs to another human principal",
      );
    const sourceIds = stringArray(input.sourceIds ?? [], "sourceIds");
    const allowed = new Set(
      draft.request.sources?.sources.map((item) => item.id) ?? [],
    );
    if (sourceIds.some((id) => !allowed.has(id)))
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "A source is outside this draft scope",
      );
    const proposalId = portableId(
      "change_genesis",
      `${this.principalId}\0${input.idempotencyKey}`,
    );
    const existing = await readOptionalChange(
      join(this.#draftRoot!, "proposal.json"),
    );
    const proposal = buildGenesisProposal({
      id: proposalId,
      operationId: portableId(
        "operation_genesis",
        `${this.principalId}\0${input.idempotencyKey}`,
      ),
      idempotencyKey: input.idempotencyKey,
      author: this.#principal(),
      requestActor: draft.request.actor,
      requestBody: draft.request.body,
      requestCreatedAt: draft.request.createdAt,
      createdAt:
        existing?.id === proposalId
          ? existing.createdAt
          : this.#now().toISOString(),
      document: input.document as DstarDocument,
      sources: sourceIds,
    });
    const diagnostics = validateBaseProfile(
      input.document as DstarDocument,
      draft.request.profiles,
    );
    if (diagnostics.some((item) => item.severity === "error"))
      throw new McpBrokerError(
        "PROPOSAL_INVALID",
        "The document violates its profiles",
        { diagnosticCodes: diagnostics.map((item) => item.code) },
      );
    if (existing && !samePortableValue(existing, proposal))
      throw new McpBrokerError(
        "IDEMPOTENCY_MISMATCH",
        "The draft already contains a different genesis proposal",
      );
    try {
      if (!existing) await stageGenesisProposal(this.#draftRoot!, proposal);
      return this.#finish(
        asJson({
          status: "pending-human-decision",
          proposalId: proposal.id,
          documentRevision: documentRevision(input.document as DstarDocument),
          remaining: this.#remaining(),
        }),
        byteLength(input),
      );
    } catch (error) {
      throw packageError(error);
    }
  }
}

export function safeBrokerError(error: unknown): JsonValue {
  const safe = packageError(error);
  return {
    error: {
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable,
      diagnosticCodes: safe.diagnosticCodes,
    },
  };
}
