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
  type DstarAnnotation,
  type DstarChange,
  type DstarDocument,
  type DstarUpdateOperation,
  type InMemoryPackage,
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
import { randomBytes } from "node:crypto";
import { unwatchFile, watch, watchFile, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const MCP_TOOL_NAMES = Object.freeze([
  "list_tasks",
  "start_task",
  "get_task",
  "get_manifest",
  "get_node",
  "search_document",
  "get_annotation",
  "get_source",
  "simulate_update",
  "submit_result",
  "submit_genesis",
] as const);

export interface McpBudgets {
  readonly maxTasks: number;
  readonly maxCalls: number;
  readonly maxReadBytes: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_MCP_BUDGETS: McpBudgets = Object.freeze({
  maxTasks: 8,
  maxCalls: 128,
  maxReadBytes: 2 * 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024,
});

const MAX_RESOURCE_CATALOG = 4_096;
const MAX_RESOURCE_WATCH_PATHS = 8_192;

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
  readonly annotations: { readonly audience: readonly ["assistant"] };
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
  readonly actorId: string;
  readonly expiresAt?: string;
  readonly taskTtlMs?: number;
  readonly budgets?: Partial<McpBudgets>;
  readonly now?: () => Date;
  readonly token?: () => string;
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

interface TaskCapability {
  readonly tokenDigest: string;
  readonly mode: "delegation" | "genesis";
  readonly actorId: string;
  readonly expiresAt: string;
  readonly allowedAnnotationIds: ReadonlySet<string>;
  readonly allowedSourceIds: ReadonlySet<string>;
  readonly startingSnapshot?: PackageSnapshot;
  readonly delegationId?: string;
  readonly draft?: GenesisDraft;
  remainingCalls: number;
  remainingReadBytes: number;
  remainingOutputBytes: number;
  terminal?: { digest: string; result: JsonValue };
}

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

function bytesOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function visibleToAgent(annotation: DstarAnnotation): boolean {
  return (
    annotation.audience === undefined || annotation.audience.includes("agent")
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new McpBrokerError(
      "INVALID_ARGUMENT",
      `${name} must be a positive integer`,
    );
  }
  return value;
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new McpBrokerError(
      "INVALID_ARGUMENT",
      `${name} must contain strings`,
    );
  }
  return value;
}

function terminalDigest(value: JsonValue): string {
  return revisionOf(value);
}

function portableId(prefix: string, seed: string): string {
  return `${prefix}_${sha256Hex(new TextEncoder().encode(seed)).slice(0, 24)}`;
}

function resourceUri(scope: string, id?: string, suffix = ""): string {
  return `dstar://${scope}${id === undefined ? "" : `/${encodeURIComponent(id)}`}${suffix}`;
}

function resourceDescriptor(
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
    annotations: { audience: ["assistant"] },
  };
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
          (diagnostic) => diagnostic.code === "TXN_SNAPSHOT_STALE",
        ),
        diagnosticCodes: error.diagnostics.map((diagnostic) => diagnostic.code),
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

async function readDraft(draftRoot: string): Promise<GenesisDraft> {
  const value = parseIJson(await readFile(join(draftRoot, "draft.json")))
    .value as unknown as GenesisDraft;
  if (
    value.format !== "dstar-genesis-draft/0.1" ||
    value.request.actor.type !== "human" ||
    typeof value.request.body !== "string"
  ) {
    throw new McpBrokerError(
      "DRAFT_INVALID",
      "The fixed genesis draft is invalid",
    );
  }
  return value;
}

export class DstarMcpBroker {
  readonly mode: "document" | "genesis";
  readonly actorId: string;
  readonly expiresAt: string;
  readonly budgets: McpBudgets;
  readonly #now: () => Date;
  readonly #tokenFactory: () => string;
  readonly #taskTtlMs: number;
  readonly #tasks = new Map<string, TaskCapability>();
  readonly #packageRoot?: string;
  readonly #draftRoot?: string;
  readonly #repository?: PackageRepository;
  #resourceWatchPaths: readonly string[] = [];
  #resourcePollPaths: readonly string[] = [];
  #resourceSubscriptionsAvailable = true;
  #startedTasks = 0;
  #remainingResourceReads: number;
  #remainingResourceBytes: number;

  private constructor(options: BrokerOptions) {
    this.mode = options.mode;
    this.actorId = options.actorId;
    this.#now = options.now ?? (() => new Date());
    this.#tokenFactory =
      options.token ?? (() => randomBytes(32).toString("base64url"));
    this.#taskTtlMs = options.taskTtlMs ?? 30 * 60 * 1_000;
    this.expiresAt =
      options.expiresAt ??
      new Date(this.#now().getTime() + 8 * 60 * 60 * 1_000).toISOString();
    this.budgets = Object.freeze({
      ...DEFAULT_MCP_BUDGETS,
      ...options.budgets,
    });
    positiveInteger(this.budgets.maxTasks, "maxTasks");
    positiveInteger(this.budgets.maxCalls, "maxCalls");
    positiveInteger(this.budgets.maxReadBytes, "maxReadBytes");
    positiveInteger(this.budgets.maxOutputBytes, "maxOutputBytes");
    positiveInteger(this.#taskTtlMs, "taskTtlMs");
    this.#remainingResourceReads = this.budgets.maxCalls;
    this.#remainingResourceBytes = this.budgets.maxReadBytes;
    if (!/^[A-Za-z][A-Za-z0-9._:-]{0,254}$/.test(this.actorId)) {
      throw new McpBrokerError(
        "INVALID_ACTOR",
        "The fixed agent actor ID is invalid",
      );
    }
    if (!Number.isFinite(Date.parse(this.expiresAt))) {
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "expiresAt must be a date-time",
      );
    }
    if (options.mode === "document") {
      this.#packageRoot = resolve(options.packageRoot);
      this.#repository = new PackageRepository(resolve(options.runtimeRoot));
    } else {
      this.#draftRoot = resolve(options.draftRoot);
    }
  }

  static async create(options: BrokerOptions): Promise<DstarMcpBroker> {
    const broker = new DstarMcpBroker(options);
    if (options.mode === "document") {
      const snapshot = await broker.#repository!.open(broker.#packageRoot!);
      broker.#resourceWatchPaths = Object.freeze(
        [
          ...new Set([
            broker.#packageRoot!,
            ...snapshot.inventory.map((file) =>
              resolve(broker.#packageRoot!, dirname(file.path)),
            ),
          ]),
        ].sort(),
      );
      const pollPaths = [
        ...new Set([
          ...broker.#resourceWatchPaths,
          ...snapshot.inventory.map((file) =>
            resolve(broker.#packageRoot!, file.path),
          ),
        ]),
      ].sort();
      broker.#resourceSubscriptionsAvailable =
        pollPaths.length <= MAX_RESOURCE_WATCH_PATHS;
      broker.#resourcePollPaths = broker.#resourceSubscriptionsAvailable
        ? Object.freeze(pollPaths)
        : Object.freeze([]);
    } else {
      await readDraft(broker.#draftRoot!);
      broker.#resourceWatchPaths = Object.freeze([broker.#draftRoot!]);
      broker.#resourcePollPaths = Object.freeze([
        broker.#draftRoot!,
        join(broker.#draftRoot!, "draft.json"),
      ]);
    }
    return broker;
  }

  get resourceSubscriptionsAvailable(): boolean {
    return this.#resourceSubscriptionsAvailable;
  }

  #checkProcess(): void {
    if (this.#now().getTime() >= Date.parse(this.expiresAt)) {
      throw new McpBrokerError(
        "CAPABILITY_EXPIRED",
        "The scoped DSTAR process capability expired",
      );
    }
  }

  async #snapshot(): Promise<PackageSnapshot> {
    this.#checkProcess();
    if (this.mode !== "document")
      throw new McpBrokerError(
        "MODE_DENIED",
        "This tool requires document mode",
      );
    return this.#repository!.open(this.#packageRoot!);
  }

  #genesisResourceDescriptors(
    draft: GenesisDraft,
  ): readonly DstarMcpResourceDescriptor[] {
    const descriptors = [
      resourceDescriptor(
        "dstar://genesis/request",
        "genesis-request",
        draft.request.title,
        "Fixed human-authored request for this genesis process.",
      ),
      ...(draft.request.sources?.sources.map((source) =>
        resourceDescriptor(
          resourceUri("source", source.id),
          `source-${source.id}`,
          source.title,
          "Source metadata admitted to this genesis request.",
        ),
      ) ?? []),
    ];
    if (descriptors.length > MAX_RESOURCE_CATALOG) {
      throw new McpBrokerError(
        "RESOURCE_LIMIT_EXCEEDED",
        "The resource catalog exceeds the process limit",
      );
    }
    return Object.freeze(descriptors);
  }

  #documentResourceDescriptors(
    snapshot: PackageSnapshot,
  ): readonly DstarMcpResourceDescriptor[] {
    const annotations = new Map(
      snapshot.annotations.map((annotation) => [annotation.id, annotation]),
    );
    const eligible = snapshot.delegations.filter((delegation) => {
      const annotation = annotations.get(delegation.annotation);
      return (
        delegation.assignee.type === "agent" &&
        delegation.assignee.id === this.actorId &&
        (delegation.status === "queued" ||
          delegation.status === "in_progress") &&
        annotation !== undefined &&
        visibleToAgent(annotation)
      );
    });
    if (eligible.length === 0) return Object.freeze([]);

    const visibleAnnotationIds = new Set(
      eligible.map((delegation) => delegation.annotation),
    );
    const index = new DocumentIndex(snapshot.document);
    const descriptors: DstarMcpResourceDescriptor[] = [
      resourceDescriptor(
        "dstar://document/manifest",
        "document-manifest",
        snapshot.manifest.title,
        "Portable manifest for the fixed delegated document.",
      ),
      ...index.readingOrder.map((nodeId) =>
        resourceDescriptor(
          resourceUri("document/node", nodeId),
          `node-${nodeId}`,
          `Node ${nodeId}`,
          "Canonical node and ancestor identifiers.",
        ),
      ),
      ...snapshot.annotations
        .filter(
          (annotation) =>
            visibleAnnotationIds.has(annotation.id) &&
            visibleToAgent(annotation),
        )
        .map((annotation) =>
          resourceDescriptor(
            resourceUri("annotation", annotation.id),
            `annotation-${annotation.id}`,
            `Annotation ${annotation.id}`,
            "Agent-visible portable annotation thread.",
          ),
        ),
      ...(snapshot.sources?.sources.map((source) =>
        resourceDescriptor(
          resourceUri("source", source.id),
          `source-${source.id}`,
          source.title,
          "Portable source metadata and bounded captured text when available.",
        ),
      ) ?? []),
      ...(snapshot.projections?.projections.map((projection) =>
        resourceDescriptor(
          resourceUri("projection", projection.id, "/mapping"),
          `projection-${projection.id}-mapping`,
          `Projection mapping ${projection.id}`,
          "Portable projection metadata and canonical mapping segments.",
        ),
      ) ?? []),
    ];
    if (descriptors.length > MAX_RESOURCE_CATALOG) {
      throw new McpBrokerError(
        "RESOURCE_LIMIT_EXCEEDED",
        "The resource catalog exceeds the process limit",
      );
    }
    return Object.freeze(descriptors);
  }

  async #resourceDescriptors(): Promise<readonly DstarMcpResourceDescriptor[]> {
    this.#checkProcess();
    if (this.mode === "genesis") {
      return this.#genesisResourceDescriptors(
        await readDraft(this.#draftRoot!),
      );
    }
    return this.#documentResourceDescriptors(await this.#snapshot());
  }

  async listResources(
    signal?: AbortSignal,
  ): Promise<readonly DstarMcpResourceDescriptor[]> {
    checkAbort(signal);
    return this.#resourceDescriptors();
  }

  async readResource(
    rawUri: string,
    signal?: AbortSignal,
  ): Promise<DstarMcpResourceContent> {
    checkAbort(signal);
    if (this.#remainingResourceReads <= 0) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The process resource read budget is exhausted",
      );
    }
    this.#remainingResourceReads -= 1;
    this.#checkProcess();
    const draft =
      this.mode === "genesis" ? await readDraft(this.#draftRoot!) : undefined;
    const snapshot =
      this.mode === "document" ? await this.#snapshot() : undefined;
    const descriptors = draft
      ? this.#genesisResourceDescriptors(draft)
      : this.#documentResourceDescriptors(snapshot!);
    if (!descriptors.some((resource) => resource.uri === rawUri)) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The resource is unavailable to this process scope",
      );
    }

    let value: JsonValue;
    if (this.mode === "genesis") {
      const currentDraft = draft!;
      if (rawUri === "dstar://genesis/request") {
        value = asJson({
          format: currentDraft.format,
          request: {
            documentId: currentDraft.request.documentId,
            title: currentDraft.request.title,
            profiles: currentDraft.request.profiles,
            actor: currentDraft.request.actor,
            body: currentDraft.request.body,
            createdAt: currentDraft.request.createdAt,
            allowedSourceIds:
              currentDraft.request.sources?.sources
                .map((source) => source.id)
                .sort() ?? [],
          },
        });
      } else {
        const source = currentDraft.request.sources?.sources.find(
          (candidate) => resourceUri("source", candidate.id) === rawUri,
        );
        if (!source) {
          throw new McpBrokerError("NOT_FOUND", "The resource does not exist");
        }
        value = asJson({ source });
      }
    } else {
      const currentSnapshot = snapshot!;
      if (rawUri === "dstar://document/manifest") {
        value = asJson({ manifest: currentSnapshot.manifest });
      } else {
        const nodeId = new DocumentIndex(
          currentSnapshot.document,
        ).readingOrder.find(
          (candidate) => resourceUri("document/node", candidate) === rawUri,
        );
        if (nodeId) {
          const index = new DocumentIndex(currentSnapshot.document);
          value = asJson({
            node: index.get(nodeId)!,
            ancestorIds: index.ancestors(nodeId).map((ancestor) => ancestor.id),
            documentRevision: currentSnapshot.manifest.revision,
          });
        } else {
          const annotation = currentSnapshot.annotations.find(
            (candidate) => resourceUri("annotation", candidate.id) === rawUri,
          );
          if (annotation) {
            value = asJson({ annotation });
          } else {
            const source = currentSnapshot.sources?.sources.find(
              (candidate) => resourceUri("source", candidate.id) === rawUri,
            );
            if (source) {
              let extract: string | undefined;
              if (source.type === "file" && source.path) {
                const bytes = currentSnapshot
                  .readFile(source.path)
                  ?.slice(0, 64 * 1024);
                if (bytes) {
                  try {
                    extract = new TextDecoder("utf-8", { fatal: true }).decode(
                      bytes,
                    );
                  } catch {
                    extract = undefined;
                  }
                }
              }
              value = asJson({
                source,
                ...(extract === undefined ? {} : { extract }),
              });
            } else {
              const projection = currentSnapshot.projections?.projections.find(
                (candidate) =>
                  resourceUri("projection", candidate.id, "/mapping") ===
                  rawUri,
              );
              if (!projection) {
                throw new McpBrokerError(
                  "NOT_FOUND",
                  "The resource does not exist",
                );
              }
              value = asJson({
                projection: {
                  id: projection.id,
                  role: projection.role,
                  mediaType: projection.mediaType,
                  reviewable: projection.reviewable,
                  generatedFromRevision: projection.generatedFromRevision,
                  revision: projection.revision,
                  segments: projection.segments,
                },
              });
            }
          }
        }
      }
    }

    const text = JSON.stringify(value);
    const size = new TextEncoder().encode(text).byteLength;
    if (size > this.#remainingResourceBytes) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The process resource byte budget is exhausted",
      );
    }
    this.#remainingResourceBytes -= size;
    return { uri: rawUri, mimeType: "application/json", text };
  }

  watchResources(
    listener: (change: DstarMcpResourceChange) => void,
  ): () => void {
    if (!this.#resourceSubscriptionsAvailable) return () => undefined;
    const watchers: FSWatcher[] = [];
    const polledPaths: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = new Set<string>();
    let closed = false;
    void this.#resourceDescriptors()
      .then((resources) => {
        previous = new Set(resources.map((resource) => resource.uri));
      })
      .catch(() => undefined);
    const onChange = () => {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void this.#resourceDescriptors()
          .then((resources) => {
            if (closed) return;
            const next = new Set(resources.map((resource) => resource.uri));
            const uris = [...new Set([...previous, ...next])].sort();
            const listChanged =
              previous.size !== next.size ||
              [...previous].some((uri) => !next.has(uri));
            previous = next;
            listener({ uris, listChanged });
          })
          .catch(() => undefined);
      }, 50);
      timer.unref?.();
    };
    const pollListener = (
      current: { mtimeMs: number; size: number },
      previousStat: { mtimeMs: number; size: number },
    ) => {
      if (
        current.mtimeMs !== previousStat.mtimeMs ||
        current.size !== previousStat.size
      ) {
        onChange();
      }
    };
    const startPolling = () => {
      if (polledPaths.length > 0 || closed) return;
      for (const path of this.#resourcePollPaths) {
        watchFile(path, { interval: 200, persistent: false }, pollListener);
        polledPaths.push(path);
      }
    };
    for (const path of this.#resourceWatchPaths) {
      try {
        const watcher = watch(path, onChange);
        watcher.on("error", () => {
          watcher.close();
          startPolling();
        });
        watcher.unref();
        watchers.push(watcher);
      } catch {
        startPolling();
      }
    }
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const path of polledPaths) unwatchFile(path, pollListener);
    };
  }

  #task(rawToken: string): TaskCapability {
    this.#checkProcess();
    const digest = sha256Hex(new TextEncoder().encode(rawToken));
    const task = this.#tasks.get(digest);
    if (!task || task.actorId !== this.actorId) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The task capability is invalid",
      );
    }
    if (this.#now().getTime() >= Date.parse(task.expiresAt)) {
      throw new McpBrokerError(
        "CAPABILITY_EXPIRED",
        "The task capability expired",
      );
    }
    return task;
  }

  #beginCall(
    rawToken: string,
    expectedMode?: TaskCapability["mode"],
    allowTerminal = false,
  ): TaskCapability {
    const task = this.#task(rawToken);
    if (expectedMode && task.mode !== expectedMode) {
      throw new McpBrokerError(
        "MODE_DENIED",
        "The tool is unavailable for this task mode",
      );
    }
    if (task.terminal) {
      if (allowTerminal) return task;
      throw new McpBrokerError("TASK_TERMINAL", "The task is already terminal");
    }
    if (task.remainingCalls <= 0)
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The task call budget is exhausted",
      );
    task.remainingCalls -= 1;
    return task;
  }

  #finish(task: TaskCapability, value: JsonValue, readBytes = 0): JsonValue {
    const outputBytes = bytesOf(value);
    if (
      readBytes > task.remainingReadBytes ||
      outputBytes > task.remainingOutputBytes
    ) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The task byte budget is exhausted",
      );
    }
    task.remainingReadBytes -= readBytes;
    task.remainingOutputBytes -= outputBytes;
    return value;
  }

  #preflightEffect(
    task: TaskCapability,
    readBytes: number,
    resultShape: JsonValue,
  ): void {
    if (
      readBytes > task.remainingReadBytes ||
      bytesOf(resultShape) > task.remainingOutputBytes
    ) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The task byte budget is insufficient for this terminal result",
      );
    }
  }

  #remaining(task: TaskCapability): JsonValue {
    return {
      calls: task.remainingCalls,
      readBytes: task.remainingReadBytes,
      outputBytes: task.remainingOutputBytes,
    };
  }

  async #freshness(task: TaskCapability): Promise<JsonValue> {
    if (!task.startingSnapshot) return { current: true };
    const current = await this.#currentTaskSnapshot(task);
    return {
      current: current.snapshotId === task.startingSnapshot.snapshotId,
      startingSnapshotId: task.startingSnapshot.snapshotId,
      currentSnapshotId: current.snapshotId,
    };
  }

  async #currentTaskSnapshot(task: TaskCapability): Promise<PackageSnapshot> {
    const current = await this.#snapshot();
    if (current.manifest.id !== task.startingSnapshot!.manifest.id) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The fixed package identity changed",
      );
    }
    const delegation = current.delegations.find(
      (candidate) => candidate.id === task.delegationId,
    );
    if (!delegation || delegation.assignee.id !== this.actorId) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The task delegation is unavailable",
      );
    }
    if (
      !task.terminal &&
      delegation.status !== "queued" &&
      delegation.status !== "in_progress"
    ) {
      throw new McpBrokerError(
        "TASK_TERMINAL",
        "The portable delegation is terminal",
      );
    }
    return current;
  }

  async listTasks(signal?: AbortSignal): Promise<JsonValue> {
    checkAbort(signal);
    const snapshot = await this.#snapshot();
    const annotations = new Map(
      snapshot.annotations.map((annotation) => [annotation.id, annotation]),
    );
    return snapshot.delegations
      .filter((delegation) => {
        const annotation = annotations.get(delegation.annotation);
        return (
          delegation.assignee.type === "agent" &&
          delegation.assignee.id === this.actorId &&
          (delegation.status === "queued" ||
            delegation.status === "in_progress") &&
          annotation !== undefined &&
          visibleToAgent(annotation)
        );
      })
      .map((delegation) => ({
        delegationId: delegation.id,
        annotationId: delegation.annotation,
        status: delegation.status,
        ...(delegation.instruction
          ? { instruction: delegation.instruction }
          : {}),
        createdAt: delegation.createdAt,
      }));
  }

  async startTask(
    delegationId?: string,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    this.#checkProcess();
    if (this.#startedTasks >= this.budgets.maxTasks) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The process task budget is exhausted",
      );
    }
    let task: TaskCapability;
    if (this.mode === "document") {
      if (!delegationId)
        throw new McpBrokerError(
          "INVALID_ARGUMENT",
          "delegationId is required",
        );
      const snapshot = await this.#snapshot();
      const delegation = snapshot.delegations.find(
        (candidate) => candidate.id === delegationId,
      );
      const annotation = delegation
        ? snapshot.annotations.find(
            (candidate) => candidate.id === delegation.annotation,
          )
        : undefined;
      if (
        !delegation ||
        delegation.assignee.id !== this.actorId ||
        (delegation.status !== "queued" &&
          delegation.status !== "in_progress") ||
        !annotation ||
        !visibleToAgent(annotation)
      ) {
        throw new McpBrokerError(
          "CAPABILITY_DENIED",
          "The delegation is not eligible for this actor",
        );
      }
      task = {
        tokenDigest: "",
        mode: "delegation",
        actorId: this.actorId,
        delegationId: delegation.id,
        startingSnapshot: snapshot,
        allowedAnnotationIds: new Set([annotation.id]),
        allowedSourceIds: new Set(
          snapshot.sources?.sources.map((source) => source.id) ?? [],
        ),
        expiresAt: new Date(
          this.#now().getTime() + this.#taskTtlMs,
        ).toISOString(),
        remainingCalls: this.budgets.maxCalls,
        remainingReadBytes: this.budgets.maxReadBytes,
        remainingOutputBytes: this.budgets.maxOutputBytes,
      };
    } else {
      if (delegationId !== undefined) {
        throw new McpBrokerError(
          "INVALID_ARGUMENT",
          "delegationId is unavailable in genesis mode",
        );
      }
      const draft = await readDraft(this.#draftRoot!);
      task = {
        tokenDigest: "",
        mode: "genesis",
        actorId: this.actorId,
        draft,
        allowedAnnotationIds: new Set(),
        allowedSourceIds: new Set(
          draft.request.sources?.sources.map((source) => source.id) ?? [],
        ),
        expiresAt: new Date(
          this.#now().getTime() + this.#taskTtlMs,
        ).toISOString(),
        remainingCalls: this.budgets.maxCalls,
        remainingReadBytes: this.budgets.maxReadBytes,
        remainingOutputBytes: this.budgets.maxOutputBytes,
      };
    }
    const token = this.#tokenFactory();
    const tokenDigest = sha256Hex(new TextEncoder().encode(token));
    if (this.#tasks.has(tokenDigest))
      throw new McpBrokerError(
        "INTERNAL",
        "Could not allocate a task capability",
      );
    task = { ...task, tokenDigest };
    this.#tasks.set(tokenDigest, task);
    this.#startedTasks += 1;
    return {
      taskToken: token,
      mode: task.mode,
      expiresAt: task.expiresAt,
      ...(task.delegationId ? { delegationId: task.delegationId } : {}),
      ...(task.startingSnapshot
        ? {
            startingSnapshotId: task.startingSnapshot.snapshotId,
            startingBaseChange: task.startingSnapshot.manifest.headChange,
            startingBaseRevision: task.startingSnapshot.manifest.revision,
          }
        : {}),
      remaining: this.#remaining(task),
    };
  }

  async getTask(rawToken: string, signal?: AbortSignal): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken);
    if (task.terminal)
      throw new McpBrokerError("TASK_TERMINAL", "The task is already terminal");
    if (task.mode === "genesis") {
      return this.#finish(
        task,
        asJson({
          mode: "genesis",
          request: {
            documentId: task.draft!.request.documentId,
            title: task.draft!.request.title,
            profiles: task.draft!.request.profiles,
            actor: task.draft!.request.actor,
            body: task.draft!.request.body,
            createdAt: task.draft!.request.createdAt,
          },
          allowedSourceIds: [...task.allowedSourceIds].sort(),
          remaining: this.#remaining(task),
        }),
      );
    }
    const delegation = task.startingSnapshot!.delegations.find(
      (candidate) => candidate.id === task.delegationId,
    )!;
    const annotation = task.startingSnapshot!.annotations.find(
      (candidate) => candidate.id === delegation.annotation,
    )!;
    return this.#finish(
      task,
      asJson({
        mode: "delegation",
        delegation: {
          id: delegation.id,
          instruction: delegation.instruction ?? null,
          status: delegation.status,
        },
        annotation: {
          id: annotation.id,
          purpose: annotation.purpose,
          target: annotation.target,
        },
        freshness: await this.#freshness(task),
        remaining: this.#remaining(task),
      }),
    );
  }

  async getManifest(
    rawToken: string,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken);
    if (task.mode === "genesis") {
      return this.#finish(
        task,
        asJson({
          mode: "genesis",
          documentId: task.draft!.request.documentId,
          title: task.draft!.request.title,
          profiles: task.draft!.request.profiles,
          allowedSourceIds: [...task.allowedSourceIds].sort(),
          remaining: this.#remaining(task),
        }),
      );
    }
    return this.#finish(
      task,
      asJson({
        mode: "document",
        manifest: task.startingSnapshot!.manifest,
        freshness: await this.#freshness(task),
        remaining: this.#remaining(task),
      }),
    );
  }

  async getNode(
    rawToken: string,
    nodeId: string,
    neighborCount = 1,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken, "delegation");
    positiveInteger(neighborCount, "neighborCount");
    if (neighborCount > 5)
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "neighborCount must not exceed 5",
      );
    const index = new DocumentIndex(task.startingSnapshot!.document);
    const node = index.get(nodeId);
    if (!node)
      throw new McpBrokerError(
        "NOT_FOUND",
        "The requested node does not exist",
      );
    const position = index.orderById.get(nodeId)!;
    const neighborIds = index.readingOrder.slice(
      Math.max(0, position - neighborCount),
      Math.min(index.readingOrder.length, position + neighborCount + 1),
    );
    const value = {
      node,
      ancestorIds: index.ancestors(nodeId).map((ancestor) => ancestor.id),
      neighbors: neighborIds
        .filter((id) => id !== nodeId)
        .map((id) => ({
          id,
          type: index.get(id)!.type,
          text: nodeTextStream(index.get(id)!),
        })),
      freshness: await this.#freshness(task),
      remaining: this.#remaining(task),
    };
    return this.#finish(task, asJson(value), bytesOf(value));
  }

  async searchDocument(
    rawToken: string,
    query: string,
    limit = 10,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken, "delegation");
    if (query.trim().length === 0)
      throw new McpBrokerError("INVALID_ARGUMENT", "query must not be empty");
    positiveInteger(limit, "limit");
    if (limit > 50)
      throw new McpBrokerError("INVALID_ARGUMENT", "limit must not exceed 50");
    const index = new DocumentIndex(task.startingSnapshot!.document);
    const needle = query.toLocaleLowerCase("en-US");
    const results = index.readingOrder
      .flatMap((id, order) => {
        const node = index.get(id)!;
        const text = nodeTextStream(node);
        const lower = text.toLocaleLowerCase("en-US");
        const at = lower.indexOf(needle);
        if (at === -1) return [];
        const start = Math.max(0, at - 60);
        return [
          {
            nodeId: id,
            type: node.type,
            order,
            excerpt: text.slice(start, start + 180),
          },
        ];
      })
      .slice(0, limit);
    return this.#finish(
      task,
      asJson({
        query,
        results,
        freshness: await this.#freshness(task),
        remaining: this.#remaining(task),
      }),
      bytesOf(results),
    );
  }

  async getAnnotation(
    rawToken: string,
    annotationId: string,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken, "delegation");
    if (!task.allowedAnnotationIds.has(annotationId)) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The annotation is unavailable to this task",
      );
    }
    const annotation = task.startingSnapshot!.annotations.find(
      (candidate) => candidate.id === annotationId,
    );
    if (!annotation || !visibleToAgent(annotation)) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The annotation is unavailable to this task",
      );
    }
    return this.#finish(
      task,
      asJson({
        annotation,
        freshness: await this.#freshness(task),
        remaining: this.#remaining(task),
      }),
      bytesOf(annotation),
    );
  }

  async getSource(
    rawToken: string,
    sourceId: string,
    maxBytes = 64 * 1024,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken);
    positiveInteger(maxBytes, "maxBytes");
    if (maxBytes > 256 * 1024)
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "maxBytes must not exceed 262144",
      );
    if (!task.allowedSourceIds.has(sourceId)) {
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The source is unavailable to this task",
      );
    }
    const source = (
      task.mode === "delegation"
        ? task.startingSnapshot!.sources?.sources
        : task.draft!.request.sources?.sources
    )?.find((candidate) => candidate.id === sourceId);
    if (!source)
      throw new McpBrokerError(
        "CAPABILITY_DENIED",
        "The source is unavailable to this task",
      );
    let extract: string | undefined;
    let readBytes = bytesOf(source);
    if (task.mode === "delegation" && source.type === "file" && source.path) {
      const bytes = task.startingSnapshot!.readFile(source.path);
      if (bytes) {
        const bounded = bytes.slice(0, maxBytes);
        readBytes += bounded.byteLength;
        try {
          extract = new TextDecoder("utf-8", { fatal: true }).decode(bounded);
        } catch {
          extract = undefined;
        }
      }
    }
    return this.#finish(
      task,
      asJson({
        source,
        ...(extract === undefined ? {} : { extract }),
        ...(task.mode === "delegation"
          ? { freshness: await this.#freshness(task) }
          : {}),
        remaining: this.#remaining(task),
      }),
      readBytes,
    );
  }

  #draftUpdate(
    task: TaskCapability,
    operations: readonly DstarUpdateOperation[],
    sourceIds: readonly string[],
  ) {
    for (const sourceId of sourceIds) {
      if (!task.allowedSourceIds.has(sourceId)) {
        throw new McpBrokerError(
          "CAPABILITY_DENIED",
          "A proposal source is unavailable to this task",
        );
      }
    }
    const delegation = task.startingSnapshot!.delegations.find(
      (candidate) => candidate.id === task.delegationId,
    )!;
    const seed = revisionOf(
      asJson({ task: delegation.id, operations, sourceIds }),
    );
    return buildUpdateProposal({
      id: portableId("change", seed),
      idempotencyKey: `simulation:${seed}`,
      author: { type: "agent", id: this.actorId },
      baseChange: task.startingSnapshot!.manifest.headChange,
      baseRevision: task.startingSnapshot!.manifest.revision,
      operations,
      createdAt: this.#now().toISOString(),
      motivatedBy: [delegation.annotation],
      fulfills: [delegation.id],
      ...(sourceIds.length > 0 ? { sources: sourceIds } : {}),
    });
  }

  async simulateUpdate(
    rawToken: string,
    operationsValue: unknown,
    sourceIdsValue: unknown = [],
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken, "delegation");
    if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "operations must be a non-empty array",
      );
    }
    const operations = operationsValue as DstarUpdateOperation[];
    const sourceIds = stringArray(sourceIdsValue, "sourceIds");
    const proposal = this.#draftUpdate(task, operations, sourceIds);
    const candidate: InMemoryPackage = {
      ...task.startingSnapshot!,
      changes: [...task.startingSnapshot!.changes, proposal],
    };
    const simulation = simulateUpdateChange(candidate, proposal.id);
    return this.#finish(
      task,
      asJson({
        simulation,
        freshness: await this.#freshness(task),
        remaining: this.#remaining(task),
      }),
      bytesOf(operationsValue),
    );
  }

  async submitResult(
    rawToken: string,
    input: {
      readonly idempotencyKey: string;
      readonly operations?: unknown;
      readonly sourceIds?: unknown;
      readonly replyBody?: string;
      readonly reason?: string;
    },
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken, "delegation", true);
    const payload = asJson(input);
    const payloadBytes = bytesOf(payload);
    if (payloadBytes > task.remainingReadBytes) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The task read budget is exhausted",
      );
    }
    const digest = terminalDigest(payload);
    if (task.terminal) {
      if (task.terminal.digest !== digest) {
        throw new McpBrokerError(
          "IDEMPOTENCY_MISMATCH",
          "The terminal task payload differs from the original",
        );
      }
      return task.terminal.result;
    }
    if (input.idempotencyKey.length === 0) {
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "idempotencyKey must not be empty",
      );
    }
    const operations = input.operations === undefined ? [] : input.operations;
    if (!Array.isArray(operations))
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "operations must be an array",
      );
    const sourceIds = stringArray(input.sourceIds ?? [], "sourceIds");
    if (operations.length === 0 && !input.replyBody && !input.reason) {
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "A result requires operations, a reply, or a reason",
      );
    }
    let change: DstarChange | undefined;
    let simulation: ReturnType<typeof simulateUpdateChange> | undefined;
    if (operations.length > 0) {
      const draft = this.#draftUpdate(
        task,
        operations as DstarUpdateOperation[],
        sourceIds,
      );
      change = {
        ...draft,
        idempotencyKey: input.idempotencyKey,
        id: portableId(
          "change",
          `${task.delegationId}\0${input.idempotencyKey}`,
        ),
      };
      const candidate: InMemoryPackage = {
        ...task.startingSnapshot!,
        changes: [...task.startingSnapshot!.changes, change],
      };
      simulation = simulateUpdateChange(candidate, change.id);
      if (simulation.applicability !== "applicable") {
        throw new McpBrokerError(
          "PROPOSAL_INVALID",
          "The proposed operations are not applicable",
          {
            diagnosticCodes: simulation.diagnostics.map(
              (diagnostic) => diagnostic.code,
            ),
          },
        );
      }
    }
    const reply = input.replyBody
      ? {
          id: portableId(
            "reply",
            `${task.delegationId}\0${input.idempotencyKey}`,
          ),
          body: input.replyBody,
          author: { type: "agent" as const, id: this.actorId },
          createdAt: this.#now().toISOString(),
        }
      : undefined;
    this.#preflightEffect(
      task,
      payloadBytes,
      asJson({
        status: "pending-human-decision",
        ...(change ? { changeId: change.id, simulation } : {}),
        ...(reply ? { replyId: reply.id } : {}),
        resultSnapshotId: `snapshot:${"0".repeat(64)}`,
        canonicalHead: task.startingSnapshot!.manifest.headChange,
        canonicalRevision: task.startingSnapshot!.manifest.revision,
        staleFromStartingSnapshot: true,
      }),
    );
    try {
      const current = await this.#currentTaskSnapshot(task);
      const resultSnapshot = await new PackageCommands(
        this.#repository!,
      ).recordProposalResult(
        current,
        {
          ...(change ? { change } : {}),
          delegationId: task.delegationId!,
          completedBy: { type: "agent", id: this.actorId },
          completedAt: this.#now().toISOString(),
          ...(reply ? { reply } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        {
          expectedSnapshotId: current.snapshotId,
          idempotencyKey: `mcp-result:${task.delegationId}:${input.idempotencyKey}`,
        },
      );
      const result = asJson({
        status: "pending-human-decision",
        ...(change ? { changeId: change.id, simulation } : {}),
        ...(reply ? { replyId: reply.id } : {}),
        resultSnapshotId: resultSnapshot.snapshotId,
        canonicalHead: resultSnapshot.manifest.headChange,
        canonicalRevision: resultSnapshot.manifest.revision,
        staleFromStartingSnapshot:
          current.snapshotId !== task.startingSnapshot!.snapshotId,
      });
      const finished = this.#finish(task, result, payloadBytes);
      task.terminal = { digest, result: finished };
      return finished;
    } catch (error) {
      throw packageError(error);
    }
  }

  async submitGenesis(
    rawToken: string,
    input: {
      readonly idempotencyKey: string;
      readonly document: unknown;
      readonly sourceIds?: unknown;
    },
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    checkAbort(signal);
    const task = this.#beginCall(rawToken, "genesis", true);
    const payload = asJson(input);
    const payloadBytes = bytesOf(payload);
    if (payloadBytes > task.remainingReadBytes) {
      throw new McpBrokerError(
        "BUDGET_EXCEEDED",
        "The task read budget is exhausted",
      );
    }
    const digest = terminalDigest(payload);
    if (task.terminal) {
      if (task.terminal.digest !== digest) {
        throw new McpBrokerError(
          "IDEMPOTENCY_MISMATCH",
          "The terminal task payload differs from the original",
        );
      }
      return task.terminal.result;
    }
    if (input.idempotencyKey.length === 0) {
      throw new McpBrokerError(
        "INVALID_ARGUMENT",
        "idempotencyKey must not be empty",
      );
    }
    const sourceIds = stringArray(input.sourceIds ?? [], "sourceIds");
    for (const sourceId of sourceIds) {
      if (!task.allowedSourceIds.has(sourceId)) {
        throw new McpBrokerError(
          "CAPABILITY_DENIED",
          "A genesis source is unavailable to this task",
        );
      }
    }
    const actor: DstarActor = { type: "agent", id: this.actorId };
    const proposal = buildGenesisProposal({
      id: portableId("change_genesis", input.idempotencyKey),
      operationId: portableId("operation_genesis", input.idempotencyKey),
      idempotencyKey: input.idempotencyKey,
      author: actor,
      requestActor: task.draft!.request.actor,
      requestBody: task.draft!.request.body,
      requestCreatedAt: task.draft!.request.createdAt,
      createdAt: this.#now().toISOString(),
      document: input.document as DstarDocument,
      ...(sourceIds.length > 0 ? { sources: sourceIds } : {}),
    });
    const profileDiagnostics = validateBaseProfile(
      input.document as DstarDocument,
      task.draft!.request.profiles,
    );
    if (
      profileDiagnostics.some((diagnostic) => diagnostic.severity === "error")
    ) {
      throw new McpBrokerError(
        "PROPOSAL_INVALID",
        "The genesis document violates its declared profiles",
        {
          diagnosticCodes: profileDiagnostics.map(
            (diagnostic) => diagnostic.code,
          ),
        },
      );
    }
    const result = asJson({
      status: "pending-human-decision",
      proposalId: proposal.id,
      documentRevision: documentRevision(input.document as DstarDocument),
    });
    this.#preflightEffect(task, payloadBytes, result);
    try {
      await stageGenesisProposal(this.#draftRoot!, proposal);
      const finished = this.#finish(task, result, payloadBytes);
      task.terminal = { digest, result: finished };
      return finished;
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
