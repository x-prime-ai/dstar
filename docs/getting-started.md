# Getting started

This guide runs the source workspace, creates a pending document proposal and
opens it in the reference Viewer.

## Requirements

- Node.js 22 or newer
- pnpm 10
- a local filesystem

Install and build:

```sh
pnpm install
pnpm --filter @dstar/core build
```

## Create a document package

Use one of the checked-in complete HTML candidates:

```sh
pnpm dstar validate examples/html-first
pnpm dstar propose ./my-document.dstar \
  --candidate examples/html-first \
  --base none \
  --request "Create the document" \
  --key initial
```

This creates a package with a pending genesis proposal. It does not accept that
proposal automatically.

## Review it

```sh
pnpm dstar serve ./my-document.dstar --port 4173
```

Open the complete private Owner URL printed in the terminal. Select **Review
changes**, inspect the proposed revision and explicitly accept it. The Viewer
also prints a Reviewer URL with fewer permissions. Do not publish either bearer
link.

## Make a second version

Read the exact accepted revision and export it into a new empty directory:

```sh
pnpm dstar inspect ./my-document.dstar
pnpm dstar export ./my-document.dstar \
  --revision sha256:EXACT_ACCEPTED_REVISION \
  --out ./candidate
```

Edit `candidate/document.html`, CSS or assets, preserving stable
`data-dstar-id` values. Then validate and propose the complete candidate:

```sh
pnpm dstar validate ./candidate
pnpm dstar propose ./my-document.dstar \
  --candidate ./candidate \
  --base sha256:EXACT_ACCEPTED_REVISION \
  --request "Explain the change" \
  --key second-version
```

The already-running Viewer will show the pending proposal.

## Next steps

- Use [Core SDK](core-sdk.md) for a custom TypeScript service.
- Use [MCP integration](mcp.md) to expose caller-scoped tools.
- Use [Viewer and WebMCP](viewer.md) to embed or self-host the reference UI.
- Read [Core concepts](concepts.md) before implementing concurrency or comment
  targeting.
