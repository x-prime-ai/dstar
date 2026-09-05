# Deployment and operations

DSTAR does not require a central hosted service. Choose a topology based on who
owns the UI and lifecycle.

## Topologies

| Topology               | Use when                                             | Detailed runbook                                                                                   |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Fixed document Viewer  | one persistent package needs the reference review UI | [Viewer deployment](../deploy/viewer/README.md)                                                    |
| Custom product service | the product owns UI, auth and routes                 | [Core SDK](core-sdk.md) and [host contract](../integration/README.md)                              |
| MCP-enabled product    | an existing MCP endpoint should expose DSTAR tools   | [MCP integration](mcp.md)                                                                          |
| Resettable workspaces  | users need isolated copies of one seed               | [Workspace service](../apps/workspaces/README.md) and [deployment](../deploy/workspaces/README.md) |
| Sample library         | a site needs the checked-in demo documents           | [Example library deployment](../deploy/example-library/README.md)                                  |
| Static demonstration   | review behavior may remain browser-local             | [Static demo](../deploy/static-site/README.md)                                                     |

## Fixed Viewer checklist

- Prepare an existing DSTAR package before startup.
- Mount the package on a persistent local filesystem.
- Run exactly one writer process for that package.
- Keep Owner and Reviewer credentials outside the package and image.
- Bind the Node listener privately and terminate TLS at a trusted proxy.
- Configure one exact external origin and reject unexpected Host values.
- Preserve client Origin; remove every `Forwarded` and `X-Forwarded-*` header.
- Do not log Authorization, bearer URL fragments or `/frame/` capability paths.
- Match proxy body limits to Viewer candidate limits.
- Stop all writers before backing up or restoring the complete package.

The reference container and environment contract are documented in the
[persistent Viewer runbook](../deploy/viewer/README.md).

## Custom host checklist

- Map application document IDs to trusted package paths in host metadata.
- Derive actors and permissions from authenticated sessions.
- Never let API or MCP inputs select paths, actors or capabilities.
- Serialize writes to each package.
- Preserve exact revisions, state IDs and idempotency semantics.
- Keep decision and resolution separate from proposal generation.
- Sandbox any rendered authored HTML.
- Pin exact pre-1.0 package versions and rehearse upgrades on copies.

## Backup and restore

The accepted checkout alone is not a backup. Stop Viewer, CLI and every other
writer, then copy the complete package including `.dstar/state.json` and
`.dstar/objects/`. Back up credentials separately or rotate them after restore.

Restore into an empty location with the same application version, inspect the
package, then verify accepted and pending revisions before reopening access.
Never merge two package backups.

## Availability limits

Current DSTAR storage assumes one process and a local filesystem with reliable
exclusive create, atomic rename and `fsync`. Autoscaling, shared volumes,
multi-region writers, garbage collection, automatic stale-lock removal and
cross-version storage migration are not delivered.

The workspace service similarly runs as one process against one persistent
volume. Its wildcard DNS, TLS, quotas, credential delivery and backup policy
remain operator responsibilities.

## Verification

From this repository:

```sh
pnpm verify
```

This runs format, lint, link, build, package, static-demo, typecheck and test
checks. Viewer and service tests bind loopback ports. Before production exposure,
also verify the actual container, proxy, certificates, volume permissions,
backup restore and browser behavior in the target environment.
