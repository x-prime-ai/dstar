# Online workspace deployment preparation

This directory documents a single-node, persistent workspace service. It does
not deploy a public service, configure DNS/TLS or claim production readiness.
The existing fixed-document setup in `deploy/viewer` remains supported.

## Required boundaries

Prepare an initialized HTML-first seed with `pnpm workspace:seed`, verify it,
then mount it read-only. Mount a different persistent volume at the workspace
root. The creation credential belongs in a secret file outside both trees.

Copy `runtime.env.example` outside the repository and set every deployment
specific value. The important variables are:

| Variable                         | Contract                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DSTAR_SEED_ROOT`                | Absolute, initialized, read-only seed package. Startup-only; clients cannot override it.                                        |
| `DSTAR_WORKSPACE_ROOT`           | Absolute persistent volume for metadata, credentials and package generations.                                                   |
| `DSTAR_EXTERNAL_ORIGIN`          | Exact canonical HTTPS control origin, with no path, query or fragment.                                                          |
| `DSTAR_WORKSPACE_DOMAIN`         | Lowercase DNS suffix for `<32-hex-id>.<domain>` Viewer origins. No wildcard text.                                               |
| `DSTAR_CREATION_TOKEN_FILE`      | Absolute regular secret file; preferred over `DSTAR_CREATION_TOKEN`.                                                            |
| `DSTAR_MAX_WORKSPACES`           | Maximum live workspace directories; default 100.                                                                                |
| `DSTAR_MAX_WORKSPACE_MIB`        | Maximum seed copy size; default 64 MiB.                                                                                         |
| `DSTAR_MAX_TOTAL_MIB`            | Admission limit for stored workspace bytes; default 1024 MiB. Leave reset headroom because old/new generations briefly coexist. |
| `DSTAR_WORKSPACE_TTL_SECONDS`    | Sliding TTL; default 86400 seconds.                                                                                             |
| `DSTAR_CLEANUP_INTERVAL_SECONDS` | Expiry scan interval; default 60 seconds.                                                                                       |

The returned control and Viewer URLs contain bearer fragments. Do not log URL
fragments, Authorization headers, `/frame/` capability paths or API bodies.
Back up the whole workspace root while the service is stopped; do not merge
generations from separate backups. Restore with the same application version,
then verify a workspace read and perform an intentional credential rotation.

## Proxy and DNS

Provision one control DNS name and a wildcard covering the workspace domain,
with certificates for both. Route both names to the same internal Node port.
The service dispatches the exact control Host or a validated 32-hex workspace
subdomain. Preserve `Host`, client `Origin`, Authorization and Content-Type;
remove every `Forwarded` and `X-Forwarded-*` header. The included Nginx fragment
is illustrative and has no certificates.

The backend speaks HTTP. Firewall it from public access and terminate TLS only
at the trusted proxy. Viewer state-changing requests still require exact HTTPS
Origin and bearer authorization. Do not path-prefix workspaces or rewrite one
workspace Host to another.

Run exactly one service process and one replica for a workspace volume. The
filesystem catalog locks and atomic generation metadata protect restart and
concurrent operations, but network filesystems, multi-host locks and
load-balanced in-memory capabilities are not supported. Use a local filesystem
with reliable exclusive create, rename and fsync semantics.

## Container sample

The sample keeps the backend on host loopback. Supply a prepared host seed and
creation-token file; the image never contains either.

```sh
docker compose --env-file /absolute/private/workspaces.env \
  -p dstar-workspaces -f deploy/workspaces/compose.yaml build
docker compose --env-file /absolute/private/workspaces.env \
  -p dstar-workspaces -f deploy/workspaces/compose.yaml up -d
```

Stopping/replacing the container preserves the named workspace volume. Removing
that volume deletes every workspace and credential. The seed bind mount remains
read-only. Verify Linux ownership (UID/GID 1000), quota behavior, graceful reset
under load, wildcard TLS, DNS, proxy header filtering and backup/restore in the
target environment before exposure.
