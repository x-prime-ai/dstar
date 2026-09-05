# TypeScript host integration

Start with the [Core SDK](../../docs/core-sdk.md) and
[MCP integration](../../docs/mcp.md) guides. This directory is the corresponding
compile-checked composition example.

This private, compile-checked example consumes the public `@dstar/core`,
`@dstar/mcp` and `@dstar/viewer` packages. It is not a package for consumers to
install.

Use `@dstar/core` inside an authenticated server to open the complete document
API:

```ts
import { openDocument } from "@dstar/core";

const document = openDocument("/srv/documents/brief.dstar");
const current = document.snapshot();

const comment = document.comment({
  target,
  body: "Can we make this claim concrete?",
  author: reviewerFromYourSession,
});

document.reply(
  comment.id,
  "Added the supporting metric to the next proposal.",
  ownerFromYourSession,
  requestId,
  document.snapshot().stateId,
);
```

## Core API

| API                       | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `snapshot()`              | Read current state or an immutable revision/proposal  |
| `createRevisionRequest()` | Freeze exact feedback and an Owner instruction        |
| `updateRevisionRequest()` | Record an external or host-agent attempt              |
| `propose()`               | Submit and optionally link a complete candidate       |
| `comment()`               | Add a comment to an exact element or text target      |
| `reply()`                 | Add an optionally keyed, exact-state reply            |
| `export()`                | Materialize a revision into an empty directory        |
| `decide()`                | Accept or reject the exact proposal an Owner reviewed |
| `resolveComment()`        | Resolve a thread as a separate Owner decision         |

`@dstar/viewer` separately exports `startViewer()` for products that want the
complete reference UI and WebMCP surface rather than a custom frontend. Its
optional trusted-host `agentInvocation` callback receives one frozen revision
request plus encoded base files and returns a complete candidate. Core itself
never invokes an agent.

For model integrations, create a caller-scoped MCP server after authenticating
the request:

```ts
import { createDocumentMcp } from "./src/index.js";

const server = createDocumentMcp(packageRoot, actorFromSession, [
  "read",
  "propose",
  "comment",
  "reply",
]);
```

Owner-only sessions may additionally receive `decide` and `resolve`. Revision
request creation and invocation are Viewer/host operations, not new generic MCP
tools in this example. The MCP
caller never supplies its own identity or document path.

Decision and resolution calls require the `revision` and/or `stateId` observed
when the Owner confirmed the action. Do not refresh those values on the Owner's
behalf: concurrent review changes should fail closed instead of silently
changing what was authorized.

Accepting a linked proposal does not resolve its comments, and resolving a
comment does not accept or alter a proposal. Keep those confirmations distinct
in custom products.

Session lookup, role assignment, route protection, package selection and secret
storage belong to the integrating product. Derive every `ActorIdentity` from the
authenticated session; never trust an actor supplied by a client request.

See the [host integration contract](../../integration/README.md) before wiring
these functions into an application.
