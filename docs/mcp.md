# MCP integration

`@dstar/mcp` registers caller-scoped MCP tools backed by `@dstar/core`. It is an
adapter, not a hosted MCP endpoint: the integrating product owns transport,
authentication, document routing, authorization and storage.

## Install

```sh
pnpm add @dstar/core@0.1.0 @dstar/mcp@0.1.0 \
  @modelcontextprotocol/server@2.0.0
```

The packages require Node.js 22 or newer and ESM. Pin exact versions while the
API is pre-1.0.

## Request lifecycle

For each authenticated MCP connection or request:

1. Authenticate the caller in the host product.
2. Resolve the caller's product-level document ID to a trusted package path.
3. Derive an audit actor from the authenticated session.
4. Calculate allowed DSTAR capabilities.
5. Create a caller-scoped MCP server for that document.

Never accept the actor, capability list or filesystem path as tool arguments.

```ts
import { createMcpHandler } from "@modelcontextprotocol/server";
import { openDocument } from "@dstar/core";
import { createDstarMcpServer } from "@dstar/mcp";

const handler = createMcpHandler(({ authInfo }) => {
  const session = requireProductSession(authInfo);
  const packageRoot = documentPathFor(session.documentId);

  return createDstarMcpServer(
    {
      document: openDocument(packageRoot),
      actor: {
        id: session.user.id,
        displayName: session.user.name,
        role: session.user.role,
      },
      capabilities: capabilitiesFor(session),
    },
    { name: "product-dstar", version: "1.0.0" },
  );
});

export default handler;
```

Mount the handler using the official MCP SDK adapter for the host's HTTP
framework. A locally launched integration may use the SDK's stdio transport
instead. DSTAR does not require a particular transport.

## Capabilities and tools

`capabilities` is required and has no default. A tool is registered only when
the caller has its capability.

| Capability | MCP tool                 | Important input                                     |
| ---------- | ------------------------ | --------------------------------------------------- |
| `read`     | `dstar_get_document`     | optional exact revision or proposal reference       |
| `propose`  | `dstar_propose_revision` | exact base, complete files, request and key         |
| `comment`  | `dstar_add_comment`      | exact target and body                               |
| `reply`    | `dstar_reply_comment`    | comment ID, body, key and observed state ID         |
| `decide`   | `dstar_decide_proposal`  | proposal ID, action, revision and observed state ID |
| `resolve`  | `dstar_resolve_comment`  | comment ID and observed state ID                    |

A typical reviewer might receive `read`, `comment` and `reply`. A product may
reserve `decide` and `resolve` for a separate owner flow. DSTAR does not define
those product roles; the capability policy is entirely host-owned.

## Submitted file format

The proposal tool accepts a complete serialized file set:

```json
{
  "base": "sha256:...",
  "request": "Make the risks explicit",
  "key": "proposal-request-123",
  "files": [
    {
      "path": "document.html",
      "encoding": "utf8",
      "content": "<!doctype html>..."
    },
    {
      "path": "assets/chart.png",
      "encoding": "base64",
      "content": "iVBORw0..."
    }
  ]
}
```

HTML and CSS use UTF-8; binary assets use canonical base64. Omitted files are
deleted if the proposal is accepted. The adapter rejects unsafe paths,
unsupported resources, duplicate or case-colliding paths and oversized input.

## Exact-state workflow

The MCP client first calls `dstar_get_document`, then uses the returned
`revision` and `stateId`:

- proposal `base` is the exact accepted revision;
- reply `expectedStateId` protects the observed thread state;
- decision includes both the exact proposal revision and state ID;
- resolution includes the observed state ID.

On a stale-state failure, return the conflict to the caller. Do not refresh and
repeat a user-authorized decision silently.

## MCP is not WebMCP

`@dstar/mcp` is a server-side standard MCP adapter. Browser WebMCP is part of
`@dstar/viewer`: the trusted Viewer page registers browser tools and maps them
onto its ordinary document HTTP API. Neither surface calls the other, and both
ultimately invoke Core.

## Custom registration

Use `registerDstarTools(server, options)` when the product already owns an
`McpServer` and wants DSTAR tools alongside other tools. Use
`createDstarMcpServer(options, info?)` when DSTAR can create the server object.

See the compile-checked [TypeScript host example](../examples/typescript-host/README.md)
and the [host integration contract](../integration/README.md).
