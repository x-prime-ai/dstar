# MCP Server Design

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## 1. Boundary

The MCP server is a thin adapter over the canonical-HTML core and package
runtime. It exposes one fixed document or genesis draft to a compatible client.
The launcher fixes package scope, authenticated human principal, expiry,
budgets, and filesystem handles unavailable to tool arguments.

DSTAR does not record the client's model, provider, session, executor,
delegation, or task lifecycle in portable state.

## 2. Authority

MCP tools may:

- read the fixed manifest and bounded canonical files;
- inspect stable elements, comments, sources, styles, and assets;
- simulate a complete candidate against an explicit base;
- append a reply attributed to the fixed human principal;
- record a pending candidate proposal; and
- stage a pending genesis candidate.

MCP exposes no tool for accepting, rejecting, superseding, resolving, changing
identity, selecting another package, arbitrary filesystem access, shell
execution, or unrestricted network access.

## 3. Process modes

```text
dstar mcp document <document.dstar> --principal <human-id>
dstar mcp genesis <draft> --principal <human-id>
```

The first transport is stdio. Standard output contains only MCP messages;
redacted diagnostics use standard error.

## 4. Tools

| Tool                 | Mode     | Effect                                                                     |
| -------------------- | -------- | -------------------------------------------------------------------------- |
| `get_manifest`       | both     | Current manifest or fixed genesis request                                  |
| `get_document`       | document | Bounded canonical HTML and declared file inventory                         |
| `get_element`        | document | Stable element HTML, text, ancestors, nearby elements, and relevant styles |
| `search_document`    | document | Deterministic search over normalized visible text                          |
| `list_comments`      | document | Comment summaries, optionally assigned to the principal                    |
| `get_annotation`     | document | One portable annotation thread and target status                           |
| `get_source`         | both     | Source metadata without implicit fetching                                  |
| `simulate_candidate` | document | Validate complete candidate and return revision/diff diagnostics           |
| `submit_candidate`   | document | Persist one pending candidate proposal                                     |
| `reply_comment`      | document | Append one reply under the fixed principal                                 |
| `submit_genesis`     | genesis  | Stage one pending complete genesis candidate                               |

Candidate simulation and submission include explicit `baseChange` and
`baseRevision`. Candidate files are bounded and may refer only to staged assets
admitted by the server-held draft or package scope.

Terminal writes are idempotent by principal plus caller-supplied idempotency
key. A stale candidate may be retained for inspection but is never silently
rebased or accepted.

## 5. Resources

Optional Resources expose the same fixed scope:

| URI                                    | Contents                     |
| -------------------------------------- | ---------------------------- |
| `dstar://document/manifest`            | Current manifest             |
| `dstar://document/html`                | Canonical `document.html`    |
| `dstar://document/element/{elementId}` | Stable element context       |
| `dstar://document/style/{styleId}`     | Declared stylesheet content  |
| `dstar://annotation/{annotationId}`    | Annotation thread            |
| `dstar://source/{sourceId}`            | Source metadata              |
| `dstar://genesis/request`              | Fixed public genesis request |

Resources grant no additional mutation authority. Clients without Resource
support use equivalent read tools.

## 6. Candidate transport

Small HTML/CSS files may be supplied directly. Larger candidates use bounded
staging handles created by the fixed genesis/document process; handles cannot
name host paths or outlive their scope. Asset bytes are digested and validated
before candidate simulation.

The server recomputes identity, safety, candidate revision, semantic review
diff, and storage representation. Caller-provided hashes or diffs are hints
only.

## 7. MCP App

An optional MCP App may package the same sandboxed viewer and review controller
used by the standalone UI. The canonical HTML remains in a nested untrusted
frame. Embedding the UI does not expose hidden human-decision commands.

## 8. Verification

Tests cover fixed package/draft isolation, principal immutability, bounded HTML
and asset reads, stable-element context, comment read/reply, complete candidate
simulation/submission, explicit stale bases, idempotent retries, inability to
discover decision methods, Resources fallback, and protocol-only stdout.

A release test submits a candidate through a generic MCP client and verifies
that canonical revision and head remain unchanged until a separate interactive
human decision accepts it.
