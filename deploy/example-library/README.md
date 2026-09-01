# DSTAR demo behind Thinkofu `/dstar`

This packages the four-document demo as one persistent Node service. Thinkofu
keeps the public URL and rewrites `/dstar` requests to this backend. The browser
therefore sees one origin, for example:

- `https://thinkofu.example/dstar/`
- `https://thinkofu.example/dstar/documents/dstar-doc/`

The backend needs a writable persistent volume at `/data`. Vercel Functions are
not the storage/runtime boundary for this service: the Engine uses filesystem
locking, atomic rename and fsync, and the Viewer keeps preview and handoff
capabilities in one long-running process.

## Shared proxy credential

Generate one random credential and store the same value in:

1. the DSTAR host secret mounted at `/run/secrets/proxy_token`; and
2. Thinkofu's `DSTAR_PROXY_TOKEN` deployment environment variable.

The DSTAR backend rejects every request without that credential. The Thinkofu
proxy adds it only to the upstream request, and DSTAR removes it before routing
to a Viewer. Do not expose it to browser JavaScript, response headers or logs.

```sh
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync(process.argv[1], randomBytes(32).toString("hex") + "\n", {flag:"wx",mode:0o600});' /absolute/private/thinkofu-proxy-token
```

## Container startup

Copy `runtime.env.example` outside the repository, replace the public origin,
and start exactly one replica:

```sh
docker compose --env-file /absolute/private/dstar-demo.env \
  -p dstar-demo -f deploy/example-library/compose.yaml build
docker compose --env-file /absolute/private/dstar-demo.env \
  -p dstar-demo -f deploy/example-library/compose.yaml up -d
```

The sample packages and review history live in the named volume. Stop the
service before backing up the whole volume. Do not autoscale this filesystem
implementation. Terminate TLS at the container platform and configure its
health checks outside `/dstar`; the backend itself should remain reachable only
through the Thinkofu rewrite when the platform supports private ingress.

Set Thinkofu's `DSTAR_UPSTREAM_ORIGIN` to the backend's canonical HTTPS origin,
without a trailing slash. Its `/dstar` proxy preserves the public browser URL,
injects the shared credential, and disables Supabase session processing for
these routes.
