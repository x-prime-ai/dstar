# DSTAR workspace service

This service creates isolated, resettable review workspaces by copying one
operator-selected HTML-first DSTAR seed. It is separate from the fixed-document
`startViewer` and persistent Viewer entrypoint; those interfaces remain
unchanged.

The service is deployment preparation, not a hosted deployment or a
multi-region claim. Each workspace receives a random 128-bit ID, a private
package generation, an owner reset credential and a dedicated Viewer instance.
The seed path comes only from startup configuration. No request, URL, Host or
workspace ID can select a filesystem path.

## Local run

Build the Engine and create a disposable seed from the checked-in safe HTML
example:

```sh
pnpm --filter @dstar/engine build
pnpm workspace:seed /absolute/private/seed.dstar
mkdir -p /absolute/private/workspace-data
DSTAR_SEED_ROOT=/absolute/private/seed.dstar \
  DSTAR_WORKSPACE_ROOT=/absolute/private/workspace-data \
  pnpm workspaces:start
```

Open the printed control origin and choose **Create workspace**. Local Viewer
instances use loopback ephemeral ports, so their origins may change after a
service restart. The workspace ID, generation, package and credential persist.
Use the external subdomain mode below for stable URLs.

The service never writes the seed. A create or reset copies regular files into
a private generation and checks a deterministic digest before publishing it.
The seed and data roots must be separate absolute trees without symlinks.

## API and adapter

Control requests require the exact control Host and Origin. External creation
also requires the configured creation bearer. The minimal browser page keeps
credentials in URL fragments and removes the fragment from the address bar.

| Route                                         | Authorization                   | Result                                                |
| --------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `POST /api/v1/workspaces` with `{}`           | creation bearer when configured | `201` with workspace, management URL and session URLs |
| `GET /api/v1/workspaces/:id`                  | workspace owner bearer          | current workspace and session URLs                    |
| `POST /api/v1/workspaces/:id/reset` with `{}` | workspace owner bearer          | drained new generation and rotated URLs               |

The success shape is
`{workspace:{id,generation,createdAt,expiresAt},manageUrl,sessions}`. The default
adapter exposes `{ownerUrl}` through the current legacy Viewer token. The
Owner/Reviewer task composes without a workspace role system by supplying:

```js
sessionAdapter: {
  create({ ownerToken, randomToken }) {
    return {
      ownerToken,
      viewerOptions: {
        ownerToken,
        reviewerToken: randomToken(),
        ownerDisplayName: "Owner",
        reviewerDisplayName: "Reviewer",
      },
    };
  },
  start({ viewerOptions, workspaceManagementUrl }) {
    return { ...viewerOptions, workspaceManagementUrl };
  },
  links({ viewer }) {
    return {
      ownerUrl: viewer.ownerUrl,
      reviewerUrl: viewer.reviewerUrl,
    };
  },
}
```

`viewerOptions` is persisted as an opaque private generation credential file;
the workspace service does not interpret roles. Reset calls the adapter again,
so every configured role token rotates together. `ownerToken` is additionally
the reset gate and must be preserved by the adapter. Do not store tokens in the
DSTAR package or return them from Viewer APIs.

The optional `start` hook receives the full owner-only management URL after the
control listener has an origin. Once the Viewer redesign accepts a
`workspaceManagementUrl` option, this hook can pass it through to the
owner-only header/identity overflow link. It does not add reset logic to Viewer
and does not touch Versions or Review changes DOM.

Common errors use stable codes: `owner_required` (`401`), `invalid_origin` or
`invalid_authority` (`403`), `workspace_not_found` (`404`),
`workspace_limit` (`429`) and `workspace_resetting` (`503`).

## Lifecycle and isolation

- A workspace ID is random, immutable and never reused. Generation starts at
  1 and increments only after reset publishes a complete seed copy.
- Reset first marks the Viewer unavailable, stops accepting new requests and
  drains accepted requests. It then copies the seed, atomically switches
  metadata, rotates the complete session configuration, starts a new Viewer and
  deletes the old generation. Closing the old Viewer clears preview capabilities
  and every process-local handoff record. This includes address-comment tokens,
  reply drafts and revoke capabilities when the comment-agent routes are
  integrated; workspace code does not duplicate those route semantics.
- Metadata, credentials and packages live under
  `WORKSPACE_ROOT/workspaces/<id>/`. Atomic metadata is the restart source of
  truth; abandoned staging and non-current generations are removed at startup.
  Comments, proposals, decisions and accepted files therefore survive restart;
  in-memory previews and handoffs intentionally do not.
- A persistent service lease rejects a second local process for the same root;
  dead-process operation locks are recovered on restart. Filesystem locks
  serialize create, reset and cleanup. Run one service process against a
  volume: multi-host/shared-filesystem locking, load-balanced capability
  routing and autoscaling are not supported.
- Default limits are 100 workspaces, 64 MiB per seed copy, 1 GiB total stored
  bytes and a 24-hour sliding TTL. Creation and reset check count/disk limits;
  expired IDs are drained and removed by the periodic cleaner. Configure lower
  limits for the actual volume and monitor it independently.
- An owner URL and all session URLs are private bearer links. External workspace
  origins remain stable across reset, but their fragments rotate. After TTL
  deletion, the ID and every old link are permanently unavailable.

Two workspaces never share a package root, Viewer process state, bearer,
preview cache or handoff map. A Host chooses only a validated random ID and the
service resolves that ID beneath its configured storage root. The seed is never
chosen from request data.

See [deployment preparation](../../deploy/workspaces/README.md) for environment,
proxy and persistent-volume boundaries.
