# Persistent HTML-first Viewer

Deployment preparation only; no hosted service or production security claim.
This runs the new Engine/Viewer on Node 22, with **one fixed document package
and separate Owner/Reviewer credentials per instance**. It does not run the legacy
workspace server. Do not autoscale it or mount one package into multiple servers.

## Local compatibility and service startup

`pnpm dstar serve ./document.dstar` and `startViewer(root, port)` still bind
loopback with fresh independent Owner and Reviewer credentials. The CLI prints
both private role URLs.
Use `--port 4173` (or another available port) when the local address should stay
stable; omission keeps automatic port assignment.
They do **not** read the service environment variables below. Never redirect
that local session URL to shared logs or expose the local CLI through a tunnel.

The persistent entrypoint does not print a token or a login URL:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dstar/engine build
node --env-file=/absolute/private/runtime.env apps/viewer/src/start.mjs
# Or inject the same environment into: pnpm --filter @dstar/viewer start
```

Prepare an existing HTML-first package first, for example with
`pnpm dstar propose /srv/dstar/document.dstar --candidate ./candidate --base none --request "Initial document" --key initial`.
An unaccepted genesis proposal is sufficient. Missing/corrupt packages, stale
write locks, invalid config or unreadable credentials stop startup; the Viewer
does not initialize or repair a package silently.

Copy [runtime.env.example](runtime.env.example) outside version control and
set these values explicitly. Empty values are errors, not defaults.

| Environment                   | Contract                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DSTAR_PACKAGE_ROOT`          | Required absolute path to one persistent package. Never selected by a URL, header or request body.                                                                                                                                                 |
| `DSTAR_BIND_HOST`             | Literal IPv4/IPv6 address; default `127.0.0.1`. Non-loopback binding requires an external origin and explicit credential.                                                                                                                          |
| `DSTAR_PORT`                  | Decimal integer `0`–`65535`; default `0` means an ephemeral port. Use a fixed port for the proxy.                                                                                                                                                  |
| `DSTAR_EXTERNAL_ORIGIN`       | Optional on loopback; otherwise required. One exact canonical HTTPS origin, e.g. `https://review.example.com` or `https://review.example.com:8443`. No path, trailing slash, userinfo, wildcard, query or fragment. Default ports must be omitted. |
| `DSTAR_OWNER_TOKEN_FILE`      | Preferred Owner credential source: absolute small regular file **outside** the package, no final symlink. One trailing LF/CRLF is allowed.                                                                                                         |
| `DSTAR_OWNER_TOKEN`           | Alternative server-injected Owner credential; never set both Owner sources. The service entrypoint requires an Owner credential.                                                                                                                   |
| `DSTAR_REVIEWER_TOKEN_FILE`   | Optional Reviewer credential file with the same constraints. Configure it to enable a restart-stable Reviewer link.                                                                                                                                |
| `DSTAR_REVIEWER_TOKEN`        | Alternative server-injected Reviewer credential; never set both Reviewer sources. It must differ from the Owner credential.                                                                                                                        |
| `DSTAR_OWNER_DISPLAY_NAME`    | Optional trusted Owner display name; default `Owner`.                                                                                                                                                                                              |
| `DSTAR_REVIEWER_DISPLAY_NAME` | Optional trusted Reviewer display name; default `Reviewer` when Reviewer access is configured.                                                                                                                                                     |

Legacy `DSTAR_VIEWER_TOKEN(_FILE)` remains an Owner-only alias so existing
services can restart unchanged. Do not combine legacy and named Owner sources.

Credentials must be 48–256 ASCII base64url characters (`A-Z a-z 0-9 _ -`).
Generate random bytes, not a password or a repeated string; syntax validation
cannot measure entropy. For example, create a private file without printing it:

```sh
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync(process.argv[1], randomBytes(32).toString("hex") + "\n", {flag:"wx", mode:0o600});' /absolute/private/viewer-token
```

Give the service user read access to that file and exclusive write access to
the package. Do not put credentials in source control, container layers,
document assets, command arguments or the package backup. File credentials
are read once at startup; rotate by replacing the file and restarting. A
symlink-based secret manager must deliver a regular file to this entrypoint.

To enter the existing Viewer, privately open
`https://review.example.com/#OWNER_TOKEN` or
`https://review.example.com/#REVIEWER_TOKEN` using the credential for that
person's role. The current UI moves the fragment into
session storage and removes it from the address bar. Share neither this URL
nor preview URLs (which contain read capabilities). Browser extensions and a
trusted local process remain outside this boundary. Owner may decide, resolve
and manage sharing; Reviewer may comment, reply, suggest, propose and use agent
handoff but cannot decide or resolve. The configured display name and fixed role
are persisted as write attribution; request bodies cannot override authors.
Programmatic callers may use `startViewer(root, port, {host, externalOrigin,
ownerToken, reviewerToken, ownerDisplayName, reviewerDisplayName})`, with file
variants for each token. Legacy `token/tokenFile` remains an Owner alias. The
return value is `{server, origin, url, ownerUrl, reviewerUrl?}`, where `url` is
the compatibility alias for `ownerUrl`. Treat all returned role URLs as secrets
and never log them in a service.

## TLS proxy and instance boundaries

Node serves HTTP on the internal listener. Place it behind a trusted TLS
proxy; firewall the backend so clients cannot reach it directly. The Compose
sample publishes only `127.0.0.1:3000`. TLS protects credentials in transit;
setting an HTTPS external origin does not enable TLS inside Node.

The Viewer accepts only the exact configured origin's `Host` (including its
non-default port). The proxy must reject other client Hosts, then preserve or
set this fixed Host. Never synthesize `Origin`: preserve the client's value.
Every POST still requires the exact origin, `application/json` and Bearer auth;
an API GET with an Origin also must match. CLI API GETs may omit Origin.
Sandboxed preview reads retain their opaque `null` origin, read capability,
restrictive CSP, and sandbox without `allow-same-origin`.

All `Forwarded` and `X-Forwarded-*` request headers are rejected, even if they
name the expected host. There is no `trustProxy` switch, inferred origin,
host wildcard or prefix routing. Configure the proxy to remove them, including
headers supplied by clients. [nginx.conf.example](nginx.conf.example) uses an
explicit header allowlist; see the [Nginx directive reference](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass_request_headers).
It also avoids logging preview capabilities. Review inherited proxy/CDN/WAF
logging: redact Authorization, URL fragments collected by client telemetry,
query strings and `/frame/` paths. Do not cache authenticated state or previews.
The example is not a provisioned TLS setup; validate certificates, limits and
proxy configuration separately before exposure.

The proxy example sets `client_max_body_size 48m` to match the agent JSON
request cap (Nginx otherwise defaults to 1 MiB; see
[client_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)).
Decoded candidate files remain limited to 32 MiB by the Engine/agent API.
Compose gives `/tmp` 64 MiB so an allowed candidate can be staged; budget
additional memory and proxy temporary disk for concurrent requests. These
limits are not a load-test or production capacity guarantee.

Use a **different origin, credential pair, package root and volume for every
instance**. Do not host instances at different paths of one browser origin or
reuse credentials. There is no global credential store, package picker,
cross-instance lookup or tenant access-control system. Tests cover separately
configured instances; they do not prove hostile multi-tenant isolation or stop
a host administrator from deliberately reusing credentials/directories.

## Container and persistent volume

The [Dockerfile](Dockerfile) builds only Engine/Viewer and assembles production
dependencies using [pnpm deploy](https://pnpm.io/10.x/cli/deploy). Its `--legacy`
flag selects pnpm's packaging implementation, not DSTAR's legacy server.
The final image runs as UID/GID 1000 (`node`), with Node 22 and no built-in
credential or external origin. `.dockerignore` allowlists source/manifests so
document packages and private files cannot accidentally enter the build.
Pin an approved Node image digest and scan/update dependencies as part of your
own release process; the example tag is not an immutable production pin.

[compose.yaml](compose.yaml) mounts `/data` as a named volume and the credentials
as separate read-only secrets. Host bind mounts must be prepared with matching
ownership; the service never recursively chowns an existing package. Ensure
each secret is readable by UID 1000; Compose file-backed secrets use host file
permissions. Keep the same Compose project name to retain the same volume.

For a future local container run (these commands do not publish a website):

```sh
# Supply DSTAR_EXTERNAL_ORIGIN and both host role token files to Compose.
docker compose --env-file /absolute/private/runtime.env -p dstar-review -f deploy/viewer/compose.yaml build
# First use only: initialize an EMPTY volume from a prepared candidate.
docker compose --env-file /absolute/private/runtime.env -p dstar-review -f deploy/viewer/compose.yaml run --rm --no-deps -v "$PWD/examples/html-first:/candidate:ro" viewer node --input-type=module -e 'import {open} from "@dstar/engine"; open(process.env.DSTAR_PACKAGE_ROOT).propose({candidate:"/candidate",base:null,request:"Initial document",author:"agent",key:"initial"});'
docker compose --env-file /absolute/private/runtime.env -p dstar-review -f deploy/viewer/compose.yaml up -d
```

The volume contains the accepted checkout **and** `.dstar` history, decisions,
pending proposals and comments. Restarting/replacing the process or container
preserves these; in-memory preview capabilities expire, so refresh the Viewer.
Do not use `docker compose down -v` unless intentionally deleting the data.
Use one replica and a local filesystem with reliable exclusive creation,
atomic rename and fsync; shared/network filesystem behavior is not verified.

SIGTERM/SIGINT stop accepting requests and drain HTTP connections, with a
10-second connection deadline (Compose allows 15 seconds). Synchronous Engine
work cannot be interrupted by that timer; allow shutdown to finish. After a
crash inspect `.dstar/write.lock`, verify the recorded process is gone and no
writer exists, then remove **only** the stale lock. Do not remove a recovery
journal; reopen the Engine to recover. See the [write/recovery contract](../../design/html-mvp.md#write-and-recovery-contract).

## Backup, restore and limits

Stop Viewer **and all CLI writers** before copying the entire package,
including hidden `.dstar` state and objects. A live recursive copy is not a
consistent backup. Back up the role secrets separately under appropriate access
controls, or provision new ones on restore. Restore into an empty location,
preserve permissions, and verify with `pnpm dstar inspect /restored/package`
before serving it; re-read accepted and pending previews in the restored
instance. Do not merge backup directories or overwrite a running package.

The format remains `dstar-html-0.2-dev`: there is no migration guarantee,
retention/GC, automatic stale-lock removal, HA, backup scheduler or recovery
point-in-time guarantee. Test a full restore with the exact application version
you retain. Disk growth, quotas, resource limits, TLS configuration, rate
limits and credential distribution are operator responsibilities. Startup
errors are deliberately generic to avoid leaking paths; diagnose permissions,
configuration and package integrity locally on the trusted host.

## Verification

Run `pnpm --filter @dstar/engine build`, `pnpm --filter @dstar/engine test`
and `pnpm --filter @dstar/viewer test` (the Viewer tests bind temporary ports).
The suite covers local compatibility, invalid configuration, authority/header
and path boundaries, role separation, identity spoofing, separate instance
credentials/capabilities, token rotation, accepted/pending state and attributed
comments across restarts, and actual Node subprocess
startup/SIGTERM without credential logging.

For this change, Node 22 tests, the isolated Engine/Viewer build and production
package startup/restart smoke check passed. Compose configuration parsing also
passed. The local Docker daemon was unavailable, so an actual image build/run,
Linux volume permissions and a real Nginx/TLS browser pass remain unverified.
Complete those checks before exposing an instance; these results are not a
production security certification.
