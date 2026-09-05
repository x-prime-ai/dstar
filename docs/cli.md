# CLI reference

The repository CLI is intended for local authoring, inspection and operator
work. Run it from the source workspace with `pnpm dstar`.

## Validate a candidate

```sh
pnpm dstar validate ./candidate
```

Validates the complete HTML/CSS/asset set and prints its deterministic revision
and HTML index.

## Propose a version

```sh
pnpm dstar propose ./document.dstar \
  --candidate ./candidate \
  --base sha256:EXACT_ACCEPTED_REVISION \
  --request "Describe the change" \
  --author "author-id" \
  --key "request-id"
```

Use `--base none` only for the genesis proposal. The CLI stores a pending
proposal; it never accepts one.

## Inspect

```sh
pnpm dstar inspect ./document.dstar
pnpm dstar inspect ./document.dstar --revision sha256:EXACT_REVISION
```

Prints state, state ID, revision, HTML index and file sizes. The optional
reference may also be a proposal ID.

## Export

```sh
pnpm dstar export ./document.dstar \
  --revision sha256:EXACT_REVISION \
  --out ./empty-output-directory
```

Omit `--revision` to export accepted content. The output directory must be
empty.

## Comment

Create a JSON target file:

```json
{
  "revision": "sha256:...",
  "element": "risk-summary",
  "selector": { "type": "element" }
}
```

Then add the comment:

```sh
pnpm dstar comment ./document.dstar \
  --target ./target.json \
  --body "Can we quantify this?" \
  --author "reviewer-id"
```

## Reply

```sh
pnpm dstar reply ./document.dstar \
  --comment COMMENT_UUID \
  --body "Added the metric." \
  --author "author-id"
```

The local CLI supports the simple reply form. Products and MCP integrations
should use keyed exact-state replies through Core.

## Serve Viewer

```sh
pnpm dstar serve ./document.dstar --port 4173
```

Omit `--port` for an automatically assigned loopback port. This development
command generates fresh private Owner and Reviewer credentials on every start.
Use the [persistent Viewer deployment](deployment.md) for stable credentials and
TLS.

## Human authority

The CLI intentionally has no accept, reject or resolve command. Those are
explicit authorized review actions in Viewer or in a host application using
Core.
