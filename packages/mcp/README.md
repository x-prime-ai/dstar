# `@dstar/mcp`

MCP server adapter for `@dstar/core`. It registers DSTAR tools on a caller-scoped
MCP server; it does not host document storage, authentication or an HTTP origin.
It also does not implement browser WebMCP or Viewer UI; those belong to
`@dstar/viewer`.

The integrating product authenticates each MCP request, opens the correct DSTAR
document, derives an audit identity and chooses the tools that caller may use:

```ts
import { createMcpHandler } from "@modelcontextprotocol/server";
import { openDocument } from "@dstar/core";
import { createDstarMcpServer } from "@dstar/mcp";

const handler = createMcpHandler(({ authInfo }) => {
  const session = requireProductSession(authInfo);
  const document = openDocument(documentPathFor(session));
  return createDstarMcpServer(
    {
      document,
      actor: session.actor,
      capabilities: capabilitiesFor(session),
    },
    { name: "product-dstar", version: "1.0.0" },
  );
});

export default handler;
```

`capabilities` is required and has no implicit default. It controls tool
registration for that MCP caller:

| Capability | MCP tool                 |
| ---------- | ------------------------ |
| `read`     | `dstar_get_document`     |
| `propose`  | `dstar_propose_revision` |
| `comment`  | `dstar_add_comment`      |
| `reply`    | `dstar_reply_comment`    |
| `decide`   | `dstar_decide_proposal`  |
| `resolve`  | `dstar_resolve_comment`  |

The MCP package adapts protocol inputs and outputs, validates submitted file
sets, and calls Core. Authorization remains the product's responsibility: never
derive `actor`, capabilities or a document filesystem path from untrusted tool
arguments. Mutation tools that can be retried require an idempotency key, and
reply, decision and resolution tools require the exact state observed by the
caller.

The handler is transport-independent. Mount its `fetch` handler using the MCP
SDK adapter appropriate to your HTTP framework, or use the SDK's stdio helper
for a locally launched server.
