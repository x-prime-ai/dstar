# DSTAR

HTML documents that an agent can create, a person can comment on, and both can
revise without losing history.

There is one canonical artifact: `document.html` + CSS + local assets.
A simple document, a designed page and slides are different layouts, not
different source schemas. There is no parallel source JSON.

## Working prototype

The new HTML-first path consists of:

- [Agent skill](skills/dstar-documents/SKILL.md): authoring and comment workflow.
- [Engine](packages/engine/src/index.ts): validation, revisions, comments,
  compact history and exact-base proposals.
- [CLI](scripts/dstar.mjs): the agent-facing entrypoint.
- [Viewer](apps/viewer/src/server.mjs): sandboxed preview, selection/comments,
  before/after review, human acceptance/rejection and accepted history.

The Engine creates the candidate revision, review summary and storage delta
**during `propose`**, not when the Viewer opens. No Git installation, MCP server,
hosted service or public SDK is needed. Node 22+ and pnpm are required.

## Try it

Run from this repository:

```sh
pnpm install
pnpm --filter @dstar/engine build
pnpm dstar validate examples/html-first
pnpm dstar propose ./my-document.dstar --candidate examples/html-first --base none --request "Create a document" --key first
pnpm dstar serve ./my-document.dstar
```

Open the local URL printed by `serve`. Accept the initial candidate, select text
or Alt-click an element to comment, and browse accepted versions. Keep that
local session URL private. `examples/slides-first` is an alternative starting
candidate; the same Viewer provides previous/next slide controls.

The local command uses an automatically assigned free port by default. To keep
the same port between restarts, choose one explicitly:

```sh
pnpm dstar serve ./my-document.dstar --port 4173
```

Authorization belongs to the browser tab, not the document or agent. To use a
different browser (including the in-app browser), open the **complete** URL from
the running terminal, including its `#token`, or use **Copy access link** in an
authorized Viewer. The address bar drops the token after opening, so copying
that shortened URL does not authorize another browser. The **Authorize Viewer**
screen also accepts the private link or token. After restarting the local server,
use its newly printed link. WebMCP tools register only after a successful
authenticated state read; access links must never be shared publicly.

To revise:

```sh
pnpm dstar inspect ./my-document.dstar
pnpm dstar export ./my-document.dstar --out ./candidate
# Edit the exported HTML/CSS/assets; preserve surviving data-dstar-id values.
pnpm dstar validate ./candidate
pnpm dstar propose ./my-document.dstar --candidate ./candidate --base sha256:EXACT_HASH_FROM_INSPECT --request "Describe the edit" --key second
```

The Viewer updates the review queue as proposals arrive. A proposal never changes the
accepted document. The agent CLI intentionally has no accept/reject/resolve
commands. See the [skill workflow](skills/dstar-documents/references/authoring.md)
and [comment commands](skills/dstar-documents/references/comments.md).

When the browser supports WebMCP, the top-level Viewer also registers six
document/review tools for browser agents. They can read exact versions, propose
complete HTML/CSS/assets, prepare editable comment and suggestion drafts, and
reply to comments; acceptance, posting and suggestion submission remain explicit
Viewer actions. See
[WebMCP interfaces and limits](design/webmcp.md). Browsers
without WebMCP retain normal Viewer functionality.

For a protected, fixed-document Node service, see the
[persistent Viewer setup](deploy/viewer/README.md). It adds explicit runtime
configuration, a Node 22 container and TLS-proxy/volume guidance; the local
`serve` command above is unchanged. Nothing is deployed automatically.

## Storage

```text
my-document.dstar/
├── document.html       accepted working copy (absent before genesis acceptance)
├── styles.css          optional; styles/ is also supported
├── assets/             optional local images/fonts
└── .dstar/
    ├── state.json      proposals, decisions, comments and accepted head
    └── objects/        content-addressed compressed blobs/deltas
```

Each version represents a complete immutable file set. Physical storage uses
exact-base copy/insert deltas when smaller than compressed replacements,
deduplicated objects and a checkpoint every 20 accepted versions.
No fuzzy application, automatic merge or Git repository is involved.
History still grows with genuine new content; this is not a constant-size store.

## Scope and status

This is a local MVP with development format `dstar-html-0.2-dev`, not a stable
interoperability specification. It supports static HTML/CSS, local raster images
and fonts, linear history, element/single-element text comments, replies and
human decisions. It does not yet offer arbitrary scripts/SVG, multi-user
authentication, auto-merge, garbage collection, assignment, advanced slide
scaling, or migration from the legacy JSON format.

[Vision](VISION.md), [current architecture](design/architecture.md) and
[implementation/limits](design/html-mvp.md) describe the new path.
The previous `spec/0.1`, `packages/core`, `packages/node`, `render-html`,
MCP server and older apps remain intact as legacy implementation; do not use
them to open HTML-first packages or infer the new format.

## Checks

```sh
pnpm build
pnpm --filter @dstar/engine test
pnpm --filter @dstar/viewer test
pnpm lint
pnpm typecheck
pnpm check:links
```

Viewer tests need permission to listen on loopback. The broader `pnpm verify`
also covers the retained legacy implementation.

See the [integration validation record](design/integration-validation.md) for
the tested browser/HTTP flows and the remaining native Chrome/container/TLS
verification limits.
