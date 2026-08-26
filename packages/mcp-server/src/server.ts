import {
  McpServer,
  ResourceTemplate,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";

import {
  safeBrokerError,
  DSTAR_RESOURCE_URI_TEMPLATES,
  type DstarMcpBroker,
  type MCP_TOOL_NAMES,
} from "./broker.js";

interface TokenInput {
  readonly taskToken: string;
}

interface StartTaskInput {
  readonly delegationId?: string;
}

interface NodeInput extends TokenInput {
  readonly nodeId: string;
  readonly neighborCount?: number;
}

interface SearchInput extends TokenInput {
  readonly query: string;
  readonly limit?: number;
}

interface AnnotationInput extends TokenInput {
  readonly annotationId: string;
}

interface SourceInput extends TokenInput {
  readonly sourceId: string;
  readonly maxBytes?: number;
}

interface SimulateInput extends TokenInput {
  readonly operations: readonly unknown[];
  readonly sourceIds?: readonly string[];
}

interface SubmitResultInput extends TokenInput {
  readonly idempotencyKey: string;
  readonly operations?: readonly unknown[];
  readonly sourceIds?: readonly string[];
  readonly replyBody?: string;
  readonly reason?: string;
}

interface SubmitGenesisInput extends TokenInput {
  readonly idempotencyKey: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly sourceIds?: readonly string[];
}

const stringSchema = { type: "string" } as const;
const numberSchema = { type: "integer" } as const;
const stringArraySchema = { type: "array", items: stringSchema } as const;
const operationArraySchema = {
  type: "array",
  items: { type: "object", properties: {}, additionalProperties: true },
} as const;

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
): JsonSchemaType {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
    additionalProperties: false,
  } as JsonSchemaType;
}

export const MCP_TOOL_SCHEMAS = Object.freeze({
  list_tasks: objectSchema({}),
  start_task: objectSchema({ delegationId: stringSchema }),
  get_task: objectSchema({ taskToken: stringSchema }, ["taskToken"]),
  get_manifest: objectSchema({ taskToken: stringSchema }, ["taskToken"]),
  get_node: objectSchema(
    {
      taskToken: stringSchema,
      nodeId: stringSchema,
      neighborCount: numberSchema,
    },
    ["taskToken", "nodeId"],
  ),
  search_document: objectSchema(
    { taskToken: stringSchema, query: stringSchema, limit: numberSchema },
    ["taskToken", "query"],
  ),
  get_annotation: objectSchema(
    { taskToken: stringSchema, annotationId: stringSchema },
    ["taskToken", "annotationId"],
  ),
  get_source: objectSchema(
    { taskToken: stringSchema, sourceId: stringSchema, maxBytes: numberSchema },
    ["taskToken", "sourceId"],
  ),
  simulate_update: objectSchema(
    {
      taskToken: stringSchema,
      operations: operationArraySchema,
      sourceIds: stringArraySchema,
    },
    ["taskToken", "operations"],
  ),
  submit_result: objectSchema(
    {
      taskToken: stringSchema,
      idempotencyKey: stringSchema,
      operations: operationArraySchema,
      sourceIds: stringArraySchema,
      replyBody: stringSchema,
      reason: stringSchema,
    },
    ["taskToken", "idempotencyKey"],
  ),
  submit_genesis: objectSchema(
    {
      taskToken: stringSchema,
      idempotencyKey: stringSchema,
      document: { type: "object", properties: {}, additionalProperties: true },
      sourceIds: stringArraySchema,
    },
    ["taskToken", "idempotencyKey", "document"],
  ),
} satisfies Record<(typeof MCP_TOOL_NAMES)[number], JsonSchemaType>);

function result(value: unknown): CallToolResult {
  const structured =
    value !== null && !Array.isArray(value) && typeof value === "object"
      ? (value as Record<string, unknown>)
      : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: structured,
  };
}

async function call(handler: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return result(await handler());
  } catch (error) {
    const safe = safeBrokerError(error);
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(safe) }],
      structuredContent: safe as Record<string, unknown>,
    };
  }
}

export function createDstarMcpServer(broker: DstarMcpBroker): McpServer {
  const server = new McpServer(
    { name: "dstar", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {
          listChanged: true,
          subscribe: broker.resourceSubscriptionsAvailable,
        },
      },
      instructions:
        "DSTAR exposes one fixed agent scope. Read-only resources are optional; every workflow has a tool-only fallback. Tools can submit pending agent-authored work, but no MCP path can accept canonical content.",
    },
  );

  const resourceDefinitions = [
    {
      name: "document-manifest",
      template: DSTAR_RESOURCE_URI_TEMPLATES[0],
      description: "Portable manifest for the fixed delegated document.",
      matches: (uri: string) => uri === "dstar://document/manifest",
    },
    {
      name: "document-node",
      template: DSTAR_RESOURCE_URI_TEMPLATES[1],
      description: "Canonical node and ancestor identifiers.",
      matches: (uri: string) => uri.startsWith("dstar://document/node/"),
    },
    {
      name: "annotation",
      template: DSTAR_RESOURCE_URI_TEMPLATES[2],
      description: "Agent-visible portable annotation thread.",
      matches: (uri: string) => uri.startsWith("dstar://annotation/"),
    },
    {
      name: "source",
      template: DSTAR_RESOURCE_URI_TEMPLATES[3],
      description: "Portable source metadata and bounded captured text.",
      matches: (uri: string) => uri.startsWith("dstar://source/"),
    },
    {
      name: "projection-mapping",
      template: DSTAR_RESOURCE_URI_TEMPLATES[4],
      description: "Portable projection-to-canonical mapping metadata.",
      matches: (uri: string) =>
        uri.startsWith("dstar://projection/") && uri.endsWith("/mapping"),
    },
    {
      name: "genesis-request",
      template: DSTAR_RESOURCE_URI_TEMPLATES[5],
      description: "Fixed human-authored request for a genesis process.",
      matches: (uri: string) => uri === "dstar://genesis/request",
    },
  ] as const;

  for (const definition of resourceDefinitions) {
    server.registerResource(
      definition.name,
      new ResourceTemplate(definition.template, {
        list: async () => ({
          resources: (await broker.listResources())
            .filter((resource) => definition.matches(resource.uri))
            .map((resource) => ({
              ...resource,
              annotations: { audience: ["assistant" as const] },
            })),
        }),
      }),
      {
        description: definition.description,
        mimeType: "application/json",
        annotations: { audience: ["assistant"] },
      },
      async (uri) => ({ contents: [await broker.readResource(uri.href)] }),
    );
  }

  const stopWatching = broker.watchResources((change) => {
    if (change.listChanged) server.sendResourceListChanged();
    for (const uri of change.uris) {
      void server.server.sendResourceUpdated({ uri }).catch(() => undefined);
    }
  });
  const previousClose = server.server.onclose;
  server.server.onclose = () => {
    stopWatching();
    previousClose?.();
  };

  server.registerTool(
    "list_tasks",
    {
      description:
        "List eligible DSTAR delegations assigned to this server's fixed agent actor.",
      inputSchema: fromJsonSchema<Record<string, never>>(
        MCP_TOOL_SCHEMAS.list_tasks,
      ),
      annotations: { readOnlyHint: true },
    },
    (_args, context) => call(() => broker.listTasks(context.mcpReq.signal)),
  );
  server.registerTool(
    "start_task",
    {
      description:
        "Exchange an eligible delegation, or the fixed genesis draft, for an opaque task token.",
      inputSchema: fromJsonSchema<StartTaskInput>(MCP_TOOL_SCHEMAS.start_task),
    },
    (args, context) =>
      call(() => broker.startTask(args.delegationId, context.mcpReq.signal)),
  );
  server.registerTool(
    "get_task",
    {
      description:
        "Read the fixed task request, target summary, freshness, and remaining budgets.",
      inputSchema: fromJsonSchema<TokenInput>(MCP_TOOL_SCHEMAS.get_task),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() => broker.getTask(args.taskToken, context.mcpReq.signal)),
  );
  server.registerTool(
    "get_manifest",
    {
      description:
        "Read bounded manifest or genesis-draft metadata for the current task.",
      inputSchema: fromJsonSchema<TokenInput>(MCP_TOOL_SCHEMAS.get_manifest),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() => broker.getManifest(args.taskToken, context.mcpReq.signal)),
  );
  server.registerTool(
    "get_node",
    {
      description:
        "Read one canonical node with ancestor IDs and bounded semantic neighbors.",
      inputSchema: fromJsonSchema<NodeInput>(MCP_TOOL_SCHEMAS.get_node),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.getNode(
          args.taskToken,
          args.nodeId,
          args.neighborCount,
          context.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "search_document",
    {
      description:
        "Deterministically search canonical node text in the fixed task snapshot.",
      inputSchema: fromJsonSchema<SearchInput>(
        MCP_TOOL_SCHEMAS.search_document,
      ),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.searchDocument(
          args.taskToken,
          args.query,
          args.limit,
          context.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "get_annotation",
    {
      description:
        "Read one annotation thread admitted to the fixed task's agent audience.",
      inputSchema: fromJsonSchema<AnnotationInput>(
        MCP_TOOL_SCHEMAS.get_annotation,
      ),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.getAnnotation(
          args.taskToken,
          args.annotationId,
          context.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "get_source",
    {
      description:
        "Read permitted source metadata and a bounded captured text extract without fetching a URL.",
      inputSchema: fromJsonSchema<SourceInput>(MCP_TOOL_SCHEMAS.get_source),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.getSource(
          args.taskToken,
          args.sourceId,
          args.maxBytes,
          context.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "simulate_update",
    {
      description:
        "Validate and simulate ordered DSTAR update operations without writing or accepting content.",
      inputSchema: fromJsonSchema<SimulateInput>(
        MCP_TOOL_SCHEMAS.simulate_update,
      ),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.simulateUpdate(
          args.taskToken,
          args.operations,
          args.sourceIds,
          context.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "submit_result",
    {
      description:
        "Atomically finish a delegated task with at most one pending proposal and one reply, or a no-result reason. This never accepts canonical content.",
      inputSchema: fromJsonSchema<SubmitResultInput>(
        MCP_TOOL_SCHEMAS.submit_result,
      ),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args, context) =>
      call(() =>
        broker.submitResult(args.taskToken, args, context.mcpReq.signal),
      ),
  );
  server.registerTool(
    "submit_genesis",
    {
      description:
        "Stage one agent-authored genesis proposal in the fixed draft. A separate interactive human command must accept it.",
      inputSchema: fromJsonSchema<SubmitGenesisInput>(
        MCP_TOOL_SCHEMAS.submit_genesis,
      ),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args, context) =>
      call(() =>
        broker.submitGenesis(args.taskToken, args, context.mcpReq.signal),
      ),
  );

  return server;
}
