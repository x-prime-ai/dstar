# SDK-First Implementation Roadmap

Status: **Draft**

## 1. Delivery thesis

```text
portable spec
    -> platform-neutral SDK
    -> safe Node package runtime
    -> generic MCP adapter
    -> deterministic HTML renderer
    -> comment and proposal-review UI
    -> Resources, App packaging, and hardening
```

DSTAR owns document semantics, validation, collaboration records, proposals,
decisions, and rendering. It does not own or model the software that invokes
its SDK/MCP interfaces. Protocol changes discovered during implementation land
in `spec/0.1` and fixtures before code depends on them.

## 2. Product proof

```text
human creates a genesis draft
    -> any SDK or MCP client stages a proposal for that human
    -> human accepts genesis through an interactive decision path
    -> DSTAR renders canonical HTML
    -> human creates a comment and optionally assigns it to another human
    -> assignee may use any external tools to read/reply/propose on their behalf
    -> DSTAR simulates and displays the proposal
    -> human accepts or rejects
```

Assignment never starts software and the package contains no executor task
state. Proposal surfaces cannot accept canonical content.

## 3. Public packages

```text
packages/
├── core/          @dstar/core — protocol and pure algorithms
├── node/          @dstar/node — safe package runtime and commands
├── mcp-server/    @dstar/mcp-server — generic scoped adapter
└── render-html/   @dstar/render-html — deterministic rendering

apps/
├── cli/
├── workspace-server/
└── review-web/
```

`@dstar/core` has no Node, React, filesystem, network, MCP, model, or provider
dependency. `@dstar/node` owns filesystem and transaction behavior. The MCP
package adapts public SDK commands and implements no document semantics.

## 4. Tooling baseline

- Node.js 22+, pnpm workspace, strict TypeScript, and ESM.
- Vitest for unit and integration tests.
- JSON Schema Draft 2020-12 with generated types checked for drift.
- RFC 8785 revision vectors and independent conformance verification.
- Boundary, formatting, Markdown-link, security, and release checks in CI.

## 5. Milestone 0 — Repository and SDK contract

Deliverables:

- workspace build/lint/test/CI skeleton;
- `@dstar/core` and `@dstar/node` dependency boundary;
- schema-to-types generation and drift checking;
- diagnostic registry and `minimal.dstar` fixture loader; and
- ADR template.

Exit criteria:

- clean checkout verifies with one command;
- browser-safe imports cannot reach Node dependencies;
- JSON, schemas, links, and public imports validate.

## 6. Milestone 1 — `@dstar/core`

Deliverables:

- duplicate-key-aware I-JSON parsing and limits;
- RFC 8785 document/node/projection revisions;
- immutable indexes and base-profile validation;
- manifest, history, annotation, assignment, source, and projection validation;
- selectors and target resolution;
- all six ordered update operations and semantic diff;
- accepted-version materialization; and
- in-memory builders for genesis, annotations, and proposals.

Exit criteria:

- Reader, Version Reader, Review Client, Change Producer, and pure Change
  Applier fixtures pass without opening files;
- independent revision vectors agree;
- unknown declared-profile data survives lossless processing; and
- accepted history materializes deterministically.

## 7. Milestone 2 — `@dstar/node` and CLI

Deliverables:

- safe inventory and immutable snapshots;
- external locks, journal, backup, recovery, and idempotency ledger;
- atomic commands for genesis, annotation/reply/assignment, proposal, decision,
  and version reads; and
- CLI validation, inspection, history, draft, decision, and render commands.

Human decision commands require an interactive terminal. There is no
scriptable confirmation bypass.

Exit criteria:

- fault injection yields the old or new valid package, never a hybrid;
- reopening package files rebuilds authoritative state;
- idempotent retries do not duplicate effects; and
- historical materialization works after cache deletion.

## 8. Milestone 3 — Generic MCP adapter

Modes:

```text
dstar mcp document <document.dstar> --principal <human-id>
dstar mcp genesis <draft> --principal <human-id>
```

Tools:

```text
get_manifest
list_comments
get_node
search_document
get_annotation
get_source
simulate_update
submit_proposal
reply_comment
submit_genesis
```

The process fixes document/draft and human principal. There are no executor
actors, task tokens, task discovery, or delegation lifecycle. Update calls
supply explicit bases. MCP provides no accept/reject/supersede/resolve/path,
shell, or unrestricted network operation.

Exit criteria:

- generic MCP clients start the server without schema projection errors;
- a client reads, simulates, replies, and submits a pending proposal directly;
- comments assigned to the principal can be filtered without creating tasks;
- another document or principal cannot be selected through arguments;
- canonical head stays unchanged until a separate human decision; and
- duplicate write calls do not create duplicate portable objects.

## 9. Milestone 4 — Deterministic HTML rendering

Deliverables:

- base RenderTree and profile registry;
- canonical HTML with stable node/text-run descriptors;
- HTML, Markdown, and plain-text projections with mappings;
- safe asset serving, sanitization, CSP, and visible fallbacks; and
- `dstar render` plus static reader.

Exit criteria:

- deterministic renders are byte-identical;
- projection hashes and mappings verify;
- unsafe HTML/URL/SVG/assets cannot execute active content; and
- unsupported meaningful content remains visible and preserved.

## 10. Milestone 5 — Comment and proposal-review UI

Deliverables:

- loopback workspace service with token/CSRF protection and invalidation;
- reader, review rail, diagnostics, sources, and history;
- DOM Range conversion to portable selectors;
- comment, reply, human assignment, and resolve flows; and
- proposal simulation plus human decisions.

Exit criteria:

- selections create exact portable targets across Unicode and mapped elements;
- comments and assignment survive refresh/reopen;
- ambiguous targets never attach silently;
- canonical content has no direct-edit path; and
- SDK/MCP proposals remain pending until explicit human review.

## 11. Milestone 6 — Resources, App packaging, and hardening

Deliverables:

- MCP Resource discovery/read/subscription;
- review surface packaged as an MCP App when host support exists;
- tool-only fallback;
- reusable role-fixture runner and independent validator;
- security corpus, scale limits, determinism, and release packaging; and
- compatibility matrix for multiple MCP clients.

Exit criteria:

- unsupported capabilities degrade explicitly;
- standalone and embedded surfaces share package and authority rules;
- a second implementation validates reference output; and
- deleting runtime state leaves portable content, comments, assignments,
  proposals, decisions, and history usable.

## 12. Test layers

- Unit/property: JSON, hashes, paths, Unicode, selectors, operations, history.
- Golden/conformance: packages, diagnostics, operations, MCP schemas, renders.
- Integration: locking, recovery, idempotency, MCP stdio, scope isolation.
- Browser: selection, comment, human assignment, review, history, accessibility.

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Runtime concepts leak into protocol | No executor/task/provider fields in schemas or portable fixtures |
| MCP client differences shape protocol | Keep adapter schemas non-normative |
| Long-lived MCP scope is broad | Fix document/draft and principal at launch; apply budgets |
| Caller fabricates authority | Launcher fixes principal; decision methods are absent |
| Silent proposal rebase | Require explicit base change and revision |
| Multi-file partial writes | Journal, recovery, and crash injection |
| Browser selection drift | Explicit semantic DOM maps and browser corpus |

## 14. Complete definition

The 0.1 reference implementation is complete when public packages and claimed
roles pass, generic SDK/MCP clients can submit pending proposals, deterministic
HTML and portable comments work, every accepted version materializes without
runtime state, a second implementation validates output, and no proposal-only
surface can directly decide canonical content.
