# Viewer and WebMCP

`@dstar/viewer` serves the complete reference review UI for one host-owned DSTAR
package. It includes version review, comments, replies, exact decisions,
sandboxed previews and browser WebMCP registration. It does not depend on a
DSTAR-hosted service.

For a published release, install and pin the pre-1.0 package:

```sh
pnpm add @dstar/viewer@0.1.0
```

Inside this repository the workspace package is linked by `pnpm install`.

## Start locally

```sh
pnpm dstar serve ./my-document.dstar --port 4173
```

The command prints separate private Owner and Reviewer bearer links. Open the
complete link, including its fragment. The page moves the credential into
session storage and removes it from the address bar.

Local startup creates new credentials on every restart. Use explicit persistent
credentials for a deployed service.

## Start from TypeScript

```ts
import { startViewer } from "@dstar/viewer";

const viewer = await startViewer("/srv/dstar/brief.dstar", 3000, {
  host: "127.0.0.1",
  externalOrigin: "https://docs.example.com",
  ownerTokenFile: "/run/secrets/dstar-owner",
  reviewerTokenFile: "/run/secrets/dstar-reviewer",
  ownerDisplayName: "Document owner",
  reviewerDisplayName: "Document reviewer",
});

console.log(viewer.origin);
console.log(viewer.baseUrl);
console.log(viewer.documentId);
// Never log ownerUrl or reviewerUrl.
```

The return value is:

```ts
type StartedViewer = {
  server: import("node:http").Server;
  origin: string;
  baseUrl: string;
  documentId: string;
  ownerUrl: string;
  reviewerUrl?: string;
};
```

## Host-owned page and origin

A product can run Viewer behind its own reverse proxy and present it at its own
domain. Viewer serves the document and review UI itself; it does not link back
to a DSTAR origin. The host owns TLS, routing, credentials, package persistence,
backups and monitoring.

Run one Viewer process per package. For a path-mounted instance, provide
`basePath`; for stronger browser isolation, prefer a distinct origin per
package. Never let a request choose `packageRoot`.

## Roles in the reference Viewer

The built-in session adapter provides fixed Owner and Reviewer roles:

| Operation                                        | Owner | Reviewer |
| ------------------------------------------------ | ----- | -------- |
| Read and inspect versions                        | yes   | yes      |
| Add comments and replies                         | yes   | yes      |
| Create a scoped agent handoff                    | yes   | yes      |
| Propose complete document updates through WebMCP | yes   | no       |
| Accept or reject proposals                       | yes   | no       |
| Resolve comments and manage sharing              | yes   | no       |

These are Viewer product roles, not Core roles. A custom service over Core may
define a different policy.

## HTTP API

The page first calls `GET /api/state`, receives `state.id`, then scopes document
operations under:

```text
/api/documents/:docId/...
```

Viewer UI and browser WebMCP call the same endpoints. There is no server-side
`/api/webmcp/*` namespace. See the complete [Viewer HTTP API](http-api.md).

## WebMCP

When the browser natively supports WebMCP, the trusted top-level page registers
tools after an authenticated state read. The authored document iframe cannot
register tools and never receives review credentials.

The available tools depend on the Viewer session:

- read current review context;
- read an exact immutable document revision;
- prepare editable comment or reply drafts;
- submit a complete pending proposal when authorized;
- post an authenticated, keyed exact-state reply when authorized.

Acceptance, rejection and comment resolution stay explicit human Viewer
actions. Browsers without WebMCP retain normal Viewer behavior.

This browser surface is separate from the standard server-side `@dstar/mcp`
package. See the detailed [WebMCP security model](../design/webmcp.md).

## Scoped handoffs

**Ask agent** creates a private, short-lived handoff bound to one exact Viewer
state and review context. Its credential is distinct from Owner and Reviewer
credentials. Depending on the action, it can return an editable draft or a
linked pending proposal; it cannot silently decide or resolve work.

Handoffs are in-memory and expire on timeout or Viewer restart. Treat their URLs
as secrets.

## Deploy safely

The backend speaks HTTP. Put it behind a trusted TLS proxy, firewall the internal
listener, preserve the exact Host and client Origin, strip forwarding headers
as documented, and never log credentials or preview capability URLs. Use a
single writer and persistent local volume.

Follow [Deployment and operations](deployment.md) and the detailed
[persistent Viewer runbook](../deploy/viewer/README.md).
