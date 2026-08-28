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

To revise:

```sh
pnpm dstar inspect ./my-document.dstar
pnpm dstar export ./my-document.dstar --out ./candidate
# Edit the exported HTML/CSS/assets; preserve surviving data-dstar-id values.
pnpm dstar validate ./candidate
pnpm dstar propose ./my-document.dstar --candidate ./candidate --base sha256:EXACT_HASH_FROM_INSPECT --request "Describe the edit" --key second
```

Refresh the Viewer to review the pending result. A proposal never changes the
accepted document. The agent CLI intentionally has no accept/reject/resolve
commands. See the [skill workflow](skills/dstar-documents/references/authoring.md)
and [comment commands](skills/dstar-documents/references/comments.md).

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
