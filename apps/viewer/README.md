# `@dstar/viewer`

For the complete integration guide, see [Viewer and WebMCP](../../docs/viewer.md)
and the [Viewer HTTP API](../../docs/http-api.md).

Self-hosted DSTAR review UI with its browser WebMCP surface built in. It serves one
filesystem-backed DSTAR package from one Node.js process; it does not call a
DSTAR-operated service.

Use the executable with the environment contract documented in
[`deploy/viewer`](../../deploy/viewer/README.md), or start it from a trusted
Node.js host:

```ts
import { startViewer } from "@dstar/viewer";

const viewer = await startViewer("/srv/documents/brief.dstar", 3000, {
  host: "127.0.0.1",
  externalOrigin: "https://docs.example.com",
  ownerTokenFile: "/run/secrets/dstar-owner",
  reviewerTokenFile: "/run/secrets/dstar-reviewer",
  agentInvocation: {
    identity: { id: "host-agent", displayName: "Host agent", role: "agent" },
    async invoke({ request, base }, { signal }) {
      return { files: await yourAgent({ request, base, signal }) };
    },
  },
});

console.log(viewer.origin); // Never log ownerUrl or reviewerUrl.
console.log(viewer.documentId); // API root: /api/documents/:docId/
```

The host owns persistence, identity, authorization, TLS, routing and backups.
Run one Viewer process per package and keep the backend behind a trusted reverse
proxy. Use a unique browser origin and credential pair for each package.

`agentInvocation` is optional. It is a trusted-host callback over a durable,
frozen revision request and exact encoded base files; it returns a complete
candidate file set. The host owns provider credentials, execution and billing.
Core never calls an agent. Without the hook, Owners can still use the batch
external handoff. Reviewers cannot create/invoke revision requests, propose,
decide or resolve.

After `GET /api/state` establishes the authenticated session and returns
`state.id`, document reads and writes use `/api/documents/:docId/...`. WebMCP
registers browser tools that call this same API; there is no `/api/webmcp/*`
backend.

The Owner can select multiple open comments, save one request, invoke either
agent route, reopen its durable status, and navigate request → proposal → linked
changes. Acceptance and comment resolution remain separate exact actions.

The package requires Node.js 22 or newer. The current DSTAR artifact format is a
development format and does not yet carry a cross-version migration guarantee.
