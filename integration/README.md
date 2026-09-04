# Host DSTAR on your own infrastructure

DSTAR is a format plus a local runtime, not a hosted document API. A compatible
host owns the document bytes, review history, user identity, browser origin and
operational lifecycle. DSTAR does not need to receive document content or sit on
the request path.

## Choose an integration level

| Need                                       | Use                                     | Host owns                                                            |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| Complete review UI and browser-agent tools | `@dstar/viewer` or the Viewer container | origin, auth links, package volume, TLS and proxy                    |
| MCP tools for an existing product          | `@dstar/mcp` with `@dstar/core`         | MCP transport, document routing, identity, authorization and storage |
| Custom product UI and workflow             | `@dstar/core`                           | routes, UI, identity, authorization and storage                      |
| Resettable isolated review spaces          | workspace service                       | wildcard routing, lifecycle policy, seed and volume                  |
| Local agent authoring only                 | `pnpm dstar` and the DSTAR skill        | package and candidate directories                                    |

The first option is the recommended starting point. It gives the host DSTAR's
reference review experience while keeping the deployment and all data under the
host's control.

## Reference topology

```text
MCP client ──> host-owned MCP endpoint ──> @dstar/mcp ──┐
                                                       ├──> @dstar/core
browser ─────> host-owned UI / @dstar/viewer ──────────┘         │
                                                                 ▼
                                      persistent <document>.dstar directory
```

`@dstar/mcp` is only the server-side MCP adapter. WebMCP belongs to Viewer: the
Viewer registers its own tools in supporting browsers and maps them onto its
normal document-scoped API. It is not implemented by `@dstar/mcp` and is not a
separate package or service. Both surfaces call the same Core API.

## Complete self-host path

1. Prepare a complete candidate directory with `document.html`, optional CSS
   and local assets.
2. Create a package and initial pending proposal with `@dstar/core` or the CLI.
3. Persist the entire package directory, including hidden `.dstar` state.
4. Run one `@dstar/viewer` process for that package.
5. Terminate TLS and enforce host identity at the host's reverse proxy.
6. Privately deliver distinct Owner and Reviewer access links or integrate a
   stronger host-owned session adapter.
7. Back up and restore the complete package while all writers are stopped.

The runnable container, environment contract, proxy rules and backup checklist
are in the [self-hosting guide](../deploy/viewer/README.md). The
[`@dstar/core` SDK guide](../packages/core/README.md) covers custom servers, and
the [`@dstar/mcp` guide](../packages/mcp/README.md) covers MCP mounting.

## Integration contract

A compatible host must preserve these boundaries:

- **Canonical content:** `document.html`, supported CSS and local assets are the
  source. Do not introduce a second content schema as authority.
- **Exact revisions:** an agent proposes a complete candidate against the exact
  current revision. The runtime does not fuzzy-merge or silently rebase it.
- **Human authority:** a proposal never becomes current until an authorized
  Owner explicitly accepts it. Resolving discussion is a separate action.
- **Stable targets:** preserve meaningful `data-dstar-id` values across edits so
  comments can recover or report an anchor risk.
- **Host-owned identity:** actor identity comes from the trusted host, never from
  an untrusted request body.
- **Host-owned storage:** keep package roots separate, writable by one runtime,
  and unavailable as user-selected filesystem paths.
- **Browser isolation:** authored HTML remains sandboxed and does not receive
  review credentials or WebMCP delegation.

## What is and is not stable

The SDK package manifests, typed entry points and self-host topology are formal
integration deliverables. The current artifact format is still
`dstar-html-0.2-dev`; storage migration, multi-node writers, arbitrary active
HTML and a stable `1.0` interoperability promise are not yet delivered.

Before adopting a new pre-1.0 release, pin the exact package version and test a
copy of production data. A host should not depend on private `.dstar` files;
use SDK snapshots and operations instead.
