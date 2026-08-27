import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceTemplate,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";

import {
  DSTAR_RESOURCE_URI_TEMPLATES,
  safeBrokerError,
  type DstarMcpBroker,
  type MCP_TOOL_NAMES,
} from "./broker.js";

interface ListCommentsInput {
  readonly assignedToMe?: boolean;
  readonly openOnly?: boolean;
}
interface NodeInput {
  readonly nodeId: string;
  readonly neighborCount?: number;
}
interface SearchInput {
  readonly query: string;
  readonly limit?: number;
}
interface AnnotationInput {
  readonly annotationId: string;
}
interface SourceInput {
  readonly sourceId: string;
  readonly maxBytes?: number;
}
interface ProposalInput {
  readonly idempotencyKey: string;
  readonly baseChange: string;
  readonly baseRevision: string;
  readonly operations: readonly unknown[];
  readonly motivatedBy?: readonly string[];
  readonly sourceIds?: readonly string[];
}
interface ReplyInput {
  readonly annotationId: string;
  readonly body: string;
  readonly idempotencyKey: string;
}
interface GenesisInput {
  readonly idempotencyKey: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly sourceIds?: readonly string[];
}

const stringSchema = { type: "string" } as const;
const integerSchema = { type: "integer" } as const;
const booleanSchema = { type: "boolean" } as const;
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
    ...(required.length ? { required: [...required] } : {}),
    additionalProperties: false,
  } as JsonSchemaType;
}

const proposalProperties = {
  idempotencyKey: stringSchema,
  baseChange: stringSchema,
  baseRevision: stringSchema,
  operations: operationArraySchema,
  motivatedBy: stringArraySchema,
  sourceIds: stringArraySchema,
} as const;

export const MCP_TOOL_SCHEMAS = Object.freeze({
  get_manifest: objectSchema({}),
  list_comments: objectSchema({
    assignedToMe: booleanSchema,
    openOnly: booleanSchema,
  }),
  get_node: objectSchema(
    { nodeId: stringSchema, neighborCount: integerSchema },
    ["nodeId"],
  ),
  search_document: objectSchema({ query: stringSchema, limit: integerSchema }, [
    "query",
  ]),
  get_annotation: objectSchema({ annotationId: stringSchema }, [
    "annotationId",
  ]),
  get_source: objectSchema(
    { sourceId: stringSchema, maxBytes: integerSchema },
    ["sourceId"],
  ),
  simulate_update: objectSchema(proposalProperties, [
    "baseChange",
    "baseRevision",
    "operations",
  ]),
  submit_proposal: objectSchema(proposalProperties, [
    "idempotencyKey",
    "baseChange",
    "baseRevision",
    "operations",
  ]),
  reply_comment: objectSchema(
    {
      annotationId: stringSchema,
      body: stringSchema,
      idempotencyKey: stringSchema,
    },
    ["annotationId", "body", "idempotencyKey"],
  ),
  submit_genesis: objectSchema(
    {
      idempotencyKey: stringSchema,
      document: { type: "object", properties: {}, additionalProperties: true },
      sourceIds: stringArraySchema,
    },
    ["idempotencyKey", "document"],
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
        resources: { listChanged: true, subscribe: true },
      },
      instructions:
        "DSTAR exposes one fixed document or draft scope for a human principal. Tools read portable document state and create pending proposals or replies. No MCP tool accepts, rejects, resolves, or directly changes canonical content.",
    },
  );

  const definitions = [
    [
      "document-manifest",
      DSTAR_RESOURCE_URI_TEMPLATES[0],
      (uri: string) => uri === "dstar://document/manifest",
    ],
    [
      "document-node",
      DSTAR_RESOURCE_URI_TEMPLATES[1],
      (uri: string) => uri.startsWith("dstar://document/node/"),
    ],
    [
      "annotation",
      DSTAR_RESOURCE_URI_TEMPLATES[2],
      (uri: string) => uri.startsWith("dstar://annotation/"),
    ],
    [
      "source",
      DSTAR_RESOURCE_URI_TEMPLATES[3],
      (uri: string) => uri.startsWith("dstar://source/"),
    ],
    [
      "projection-mapping",
      DSTAR_RESOURCE_URI_TEMPLATES[4],
      (uri: string) =>
        uri.startsWith("dstar://projection/") && uri.endsWith("/mapping"),
    ],
    [
      "genesis-request",
      DSTAR_RESOURCE_URI_TEMPLATES[5],
      (uri: string) => uri === "dstar://genesis/request",
    ],
  ] as const;
  const catalogs = new WeakMap<
    object,
    Promise<Awaited<ReturnType<DstarMcpBroker["listResources"]>>>
  >();
  const catalogFor = (context: object) => {
    const existing = catalogs.get(context);
    if (existing) return existing;
    const catalog = broker.listResources();
    catalogs.set(context, catalog);
    return catalog;
  };
  for (const [name, template, matches] of definitions) {
    server.registerResource(
      name,
      new ResourceTemplate(template, {
        list: async (context) => ({
          resources: (await catalogFor(context)).filter((item) =>
            matches(item.uri),
          ),
        }),
      }),
      { description: "DSTAR document resource", mimeType: "application/json" },
      async (uri) => ({ contents: [await broker.readResource(uri.href)] }),
    );
  }

  const subscriptions = new Set<string>();
  server.server.setRequestHandler("resources/subscribe", async (request) => {
    if (
      !(await broker.listResources()).some(
        (item) => item.uri === request.params.uri,
      )
    )
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "Resource is outside this document scope",
      );
    subscriptions.add(request.params.uri);
    return {};
  });
  server.server.setRequestHandler("resources/unsubscribe", async (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });
  const stopWatching = broker.watchResources((change) => {
    if (change.listChanged) server.sendResourceListChanged();
    for (const uri of change.uris)
      if (subscriptions.has(uri))
        void server.server.sendResourceUpdated({ uri }).catch(() => undefined);
  });
  const previousClose = server.server.onclose;
  server.server.onclose = () => {
    stopWatching();
    previousClose?.();
  };

  server.registerTool(
    "get_manifest",
    {
      description: "Read the fixed document manifest or genesis request.",
      inputSchema: fromJsonSchema<Record<string, never>>(
        MCP_TOOL_SCHEMAS.get_manifest,
      ),
      annotations: { readOnlyHint: true },
    },
    (_args, context) => call(() => broker.getManifest(context.mcpReq.signal)),
  );
  server.registerTool(
    "list_comments",
    {
      description:
        "List comments in the fixed document, optionally limited to comments assigned to the current human principal.",
      inputSchema: fromJsonSchema<ListCommentsInput>(
        MCP_TOOL_SCHEMAS.list_comments,
      ),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.listComments(
          args.assignedToMe,
          args.openOnly,
          context.mcpReq.signal,
        ),
      ),
  );
  server.registerTool(
    "get_node",
    {
      description: "Read one canonical node with bounded context.",
      inputSchema: fromJsonSchema<NodeInput>(MCP_TOOL_SCHEMAS.get_node),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.getNode(args.nodeId, args.neighborCount, context.mcpReq.signal),
      ),
  );
  server.registerTool(
    "search_document",
    {
      description: "Search canonical node text deterministically.",
      inputSchema: fromJsonSchema<SearchInput>(
        MCP_TOOL_SCHEMAS.search_document,
      ),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.searchDocument(args.query, args.limit, context.mcpReq.signal),
      ),
  );
  server.registerTool(
    "get_annotation",
    {
      description: "Read one portable annotation thread.",
      inputSchema: fromJsonSchema<AnnotationInput>(
        MCP_TOOL_SCHEMAS.get_annotation,
      ),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.getAnnotation(args.annotationId, context.mcpReq.signal),
      ),
  );
  server.registerTool(
    "get_source",
    {
      description: "Read source metadata without fetching external content.",
      inputSchema: fromJsonSchema<SourceInput>(MCP_TOOL_SCHEMAS.get_source),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() =>
        broker.getSource(args.sourceId, args.maxBytes, context.mcpReq.signal),
      ),
  );
  server.registerTool(
    "simulate_update",
    {
      description: "Validate and simulate proposed operations without writing.",
      inputSchema: fromJsonSchema<
        Omit<ProposalInput, "idempotencyKey"> & { idempotencyKey?: string }
      >(MCP_TOOL_SCHEMAS.simulate_update),
      annotations: { readOnlyHint: true },
    },
    (args, context) =>
      call(() => broker.simulateUpdate(args, context.mcpReq.signal)),
  );
  server.registerTool(
    "submit_proposal",
    {
      description:
        "Store a pending proposal against explicit bases. This never accepts canonical content.",
      inputSchema: fromJsonSchema<ProposalInput>(
        MCP_TOOL_SCHEMAS.submit_proposal,
      ),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args, context) =>
      call(() => broker.submitProposal(args, context.mcpReq.signal)),
  );
  server.registerTool(
    "reply_comment",
    {
      description: "Append a reply under the current human principal.",
      inputSchema: fromJsonSchema<ReplyInput>(MCP_TOOL_SCHEMAS.reply_comment),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args, context) =>
      call(() => broker.replyComment(args, context.mcpReq.signal)),
  );
  server.registerTool(
    "submit_genesis",
    {
      description:
        "Stage a genesis proposal for the fixed draft. A separate human decision must accept it.",
      inputSchema: fromJsonSchema<GenesisInput>(
        MCP_TOOL_SCHEMAS.submit_genesis,
      ),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args, context) =>
      call(() => broker.submitGenesis(args, context.mcpReq.signal)),
  );
  return server;
}
