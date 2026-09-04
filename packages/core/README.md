# `@dstar/core`

Server-side TypeScript SDK for creating, validating, reviewing and versioning
portable DSTAR HTML documents. It operates directly on a host-owned filesystem
directory and never calls a DSTAR-operated service.

## Runtime

- Node.js 22 or newer
- ESM
- local filesystem with reliable exclusive create, atomic rename and `fsync`
- one writer process per package

The current artifact format is `dstar-html-0.2-dev`. The SDK is publishable, but
the format and API remain pre-stable until the package reaches `1.0.0`.

## API

Core exposes the complete document lifecycle. It does not know whether a caller
is a person, an MCP server or another application adapter:

```ts
import { openDocument, type ActorIdentity } from "@dstar/core";

const agent: ActorIdentity = {
  id: "writer-agent",
  displayName: "Writer Agent",
  role: "agent",
};

const document = openDocument("/srv/documents/brief.dstar");
const current = document.snapshot();
const proposal = document.propose({
  candidate: "/srv/staging/brief-candidate",
  base: current.revision,
  request: "Make the launch risks explicit",
  author: agent,
  key: "launch-risks-2026-09-03",
});

console.log(proposal.id, proposal.revision, proposal.status);
```

`candidate` is a separate complete directory containing `document.html`,
optional CSS and local assets. `base` must be the exact revision returned by
`snapshot()`. Retrying the same logical proposal uses the same `key` and exactly
the same arguments.

The package exports:

| API                                            | Purpose                                        |
| ---------------------------------------------- | ---------------------------------------------- |
| `openDocument(root)`                           | Open the complete document API                 |
| `snapshot(revisionOrProposalId?)`              | Read current or immutable historical content   |
| `propose(input)`                               | Persist a complete candidate for review        |
| `comment(input)`                               | Create a comment on an exact target            |
| `reply(id, body, actor, key?, state)`          | Reply with optional idempotency/state checks   |
| `decide(id, action, revision, stateId, actor)` | Accept or reject an exact proposal             |
| `resolveComment(id, stateId, actor?)`          | Resolve a comment against exact state          |
| `export(directory, revision?)`                 | Materialize a revision into an empty directory |
| `readCandidate(directory)`                     | Validate and read a candidate file set         |
| `validateHtml(files)`                          | Validate in-memory canonical files             |
| `revision(files)`                              | Compute the deterministic file-set revision    |

All public input and result types are exported from the package root. Core does
not enforce product roles. A server must authenticate the caller, authorize the
requested operation and supply the resulting audit identity before invoking a
mutation. An MCP adapter should expose only the tools that caller may use.

For a complete review UI and WebMCP surface, use `@dstar/viewer`. For deployment
and operational boundaries, see the repository's
[`integration` guide](../../integration/README.md).
