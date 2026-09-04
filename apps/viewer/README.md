# `@dstar/viewer`

Self-hosted DSTAR review UI and browser-agent WebMCP surface. It serves one
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
});

console.log(viewer.origin); // Never log ownerUrl or reviewerUrl.
```

The host owns persistence, identity, authorization, TLS, routing and backups.
Run one Viewer process per package and keep the backend behind a trusted reverse
proxy. Use a unique browser origin and credential pair for each package.

The package requires Node.js 22 or newer. The current DSTAR artifact format is a
development format and does not yet carry a cross-version migration guarantee.
