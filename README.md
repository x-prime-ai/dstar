# DSTAR

Review AI-generated documents directly, revise them across multiple rounds,
and retain the feedback and decisions behind each version.

DSTAR gives AI products a document review and revision runtime with host-owned
data. The initial focus is reports, proposals, design explanations and slides.
See the [Vision](VISION.md) and [roadmap](design/roadmap.md) for the next
multi-comment review workflow and its planned integration improvements.

There is one canonical artifact: `document.html` + CSS + local assets.
A simple document, a designed page and slides are different layouts, not
different source schemas. There is no parallel source JSON.

Four complete [sample documents](examples/README.md) demonstrate a conventional
product brief, a rich HTML explainer, a slide deck, and a Viewer UI design spec.

[Open the live WebMCP demo](https://www.thinkofu.ai/dstar/) or read the
[WebMCP Challenge submission notes](submission/README.md).

## Documentation

Start with the [documentation index](docs/README.md). The main integration
paths are:

- [Getting started](docs/getting-started.md)
- [Core concepts](docs/concepts.md)
- [Core TypeScript SDK](docs/core-sdk.md)
- [MCP integration](docs/mcp.md)
- [Viewer and WebMCP](docs/viewer.md)
- [Viewer HTTP API](docs/http-api.md)
- [CLI reference](docs/cli.md)
- [Deployment and operations](docs/deployment.md)

## Working prototype

The new HTML-first path consists of:

- [Core](packages/core/src/index.ts): validation, revisions, comments,
  compact history and exact-base proposals.
- [MCP](packages/mcp/README.md): caller-scoped MCP tools backed by Core.
- [CLI](scripts/dstar.mjs): local development and operator tooling.
- [Viewer](apps/viewer/src/server.mjs): current-document reading, precise
  comments, a simple version timeline, Before/After review,
  role-bound identity and explicit human decisions.

Core creates the candidate revision, review summary and storage delta **during
`propose`**, not when the Viewer opens. No Git installation or hosted DSTAR
service is needed. Node 22+ and pnpm are required for this source workspace.

External products can run the same stack at their own origin and keep all
document data on their own infrastructure. Start with the
[host integration guide](integration/README.md), the
[`@dstar/core` TypeScript SDK](packages/core/README.md), the
[`@dstar/mcp` server adapter](packages/mcp/README.md), or the
[`@dstar/viewer` package](apps/viewer/README.md).

## Try it

Run from this repository:

```sh
pnpm install
pnpm --filter @dstar/core build
pnpm dstar validate examples/html-first
pnpm dstar propose ./my-document.dstar --candidate examples/html-first --base none --request "Create a document" --key first
pnpm dstar serve ./my-document.dstar
```

`serve` prints separate private Owner and Reviewer URLs. The Owner may accept,
reject, resolve, manage sharing and submit document updates. The Reviewer may
read, comment, reply and use agent handoff for reply drafts, but cannot update,
decide or resolve. Open the appropriate complete URL. Use **Review changes** to
inspect the initial proposal and create the Current version. Select text, or
Alt-click an element, to Comment. **Versions** is one newest-first list with a
plain status on each item; revision hashes and storage facts remain under
Technical details. Keep both role URLs
private. `examples/slides-first` is an alternative starting candidate; the same
Viewer applies the reusable slide shell with thumbnail navigation, buttons, and
all four arrow keys.

The local command uses an automatically assigned free port by default. To keep
the same port between restarts, choose one explicitly:

```sh
pnpm dstar serve ./my-document.dstar --port 4173
```

Authorization and its fixed Owner/Reviewer identity belong to the browser tab,
not the document or agent. To use a
different browser (including the in-app browser), open the **complete** URL from
the running terminal, including its `#token`, or use **Copy access link** in an
authorized Viewer. The address bar drops the token after opening, so copying
that shortened URL does not authorize another browser. The **Authorize Viewer**
screen also accepts the private link or token. After restarting the local server,
use its newly printed role link. Only an Owner session can copy/manage its
access link. WebMCP tools register only after a successful
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

When the browser supports WebMCP, the top-level Viewer registers role-scoped
document/review tools for browser agents. Both roles can read exact versions,
prepare editable comment/reply drafts and post an authenticated keyed reply;
only the Owner receives the tool that proposes complete HTML/CSS/assets.
Acceptance and resolution remain explicit Viewer actions. **Ask agent** copies
a private, short-lived scoped handoff URL that contains no
Owner/Reviewer session credential but does contain its own bearer credential;
another Codex task can open it and return a draft. See
[WebMCP interfaces and limits](design/webmcp.md). Browsers
without WebMCP retain normal Viewer functionality.

For a protected, fixed-document Node service, see the
[persistent Viewer setup](deploy/viewer/README.md). It adds explicit runtime
configuration, a Node 22 container and TLS-proxy/volume guidance; the local
`serve` command above is unchanged. Nothing is deployed automatically.

For isolated, resettable copies of one read-only seed, see the
[workspace service](apps/workspaces/README.md) and its
[deployment boundaries](deploy/workspaces/README.md). It adds a separate
control service with isolated Owner/Reviewer links, Owner-only management and
reset-driven credential rotation. It does not move reset lifecycle into Viewer
or change fixed-document `startViewer`. No public deployment is included.

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
and fonts, linear history, element/single-element text comments, replies,
fixed Owner/Reviewer identities and Owner decisions. It does not yet offer
arbitrary scripts/SVG, an identity provider or arbitrary users, auto-merge,
garbage collection, assignment, advanced slide
scaling, or migration from earlier pre-HTML formats.

[Vision](VISION.md), [current architecture](design/architecture.md) and
[implementation/limits](design/html-mvp.md) describe the new path.

## Checks

```sh
pnpm build
pnpm --filter @dstar/core test
pnpm --filter @dstar/mcp test
pnpm --filter @dstar/viewer test
pnpm --filter @dstar/workspaces test
pnpm lint
pnpm typecheck
pnpm check:links
```

Viewer tests need permission to listen on loopback. `pnpm verify` runs the
current HTML-first checks.

See the [integration validation record](design/integration-validation.md) for
the tested browser/HTTP flows and the remaining native Chrome/container/TLS
verification limits.

## License

Licensed under the [Apache License 2.0](LICENSE).
