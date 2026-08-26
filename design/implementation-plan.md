# Implementation Plan

Status: **Draft**

## 1. Delivery strategy

Build one end-to-end vertical slice before expanding content types or provider
features:

```text
open + validate package
    -> render canonical view
    -> create anchored comment
    -> delegate to deterministic fake agent
    -> persist proposed replace_text change
    -> simulate and review
    -> human accept
    -> regenerate projection
    -> resolve original comment against new view
```

Every milestone ends in executable tests and a usable thin workflow. Protocol
changes discovered during implementation are made in `spec/0.1` with fixtures
before code relies on them.

## 2. Proposed repository layout

```text
apps/
├── cli/                    dstar command-line interface
├── workspace-server/       loopback application/API service
├── review-web/             React review application
└── mcp-server/             scoped MCP adapter for agent sessions

packages/
├── protocol/               generated types, IDs, canonicalization, revisions
├── validator/              schema, profile, semantic, conformance validation
├── package-fs/             safe repository, snapshot, lock, transaction/recovery
├── profile-base/           dstar:base validation and semantic adapters
├── render-core/            RenderTree and mapping collector
├── render-html/            canonical and stored HTML renderers
├── render-text/            Markdown/plain-text renderers
├── evidence-core/          source registration and asset reference policy
├── review-core/            selectors, resolution, annotation/delegation commands
├── change-applier/         simulation, diff, decisions
├── agent-runtime/          jobs, context, tools, provider port
├── provider-fake/          deterministic test agent
├── local-api/              versioned transport contracts/client
└── test-kit/               builders, fixtures, crash/fault injection

spec/                       normative protocol and conformance fixtures
design/                     reference implementation design
tests/
├── conformance/            role fixtures consumed by multiple implementations
├── integration/            package/service workflows
└── e2e/                    browser north-star workflows
```

Dependency direction is enforced:

```text
protocol
  <- validator, profile-base, render-core, review-core, change-applier
  <- package-fs, render adapters, agent-runtime, local-api
  <- apps
```

`protocol` must not depend on Node, React, filesystem, HTTP, SQLite, or provider
SDKs. Cycles between packages fail CI.

## 3. Tooling baseline

- `pnpm` workspace with one lockfile.
- TypeScript strict mode with project references.
- ESM packages and explicit public exports.
- Vitest for unit/integration tests.
- fast-check or equivalent for property tests.
- Playwright for browser selection and end-to-end tests.
- JSON Schema Draft 2020-12 runtime validation.
- Generated TypeScript protocol types from the normative schemas; generated
  files are checked for drift in CI and are not edited manually.
- Formatter, linter, dependency-boundary checks, and Markdown link checks.

Third-party library choices for canonicalization, schema validation,
sanitization, SQLite, and HTTP must pass focused compatibility/security spikes
before becoming architecture dependencies.

## 4. Milestone 0 — Repository foundation

### Deliverables

- Workspace/package skeleton and CI.
- Shared TypeScript, lint, test, and build configuration.
- Schema-to-types generation with drift check.
- Diagnostic type and stable code registry.
- Fixture loader for `minimal.dstar`.
- Architecture decision record template under `design/decisions/`.

### Exit criteria

- Clean checkout installs, builds, lints, and tests with one documented command.
- Protocol packages cannot import forbidden platform dependencies.
- Existing minimal JSON and Markdown links validate in CI.
- No application code duplicates normative schema definitions manually.

## 5. Milestone 1 — Core reader and validator

### Deliverables

- I-JSON parser with duplicate-key detection and limits.
- RFC 8785 document/node revisions and raw projection hashes.
- Safe in-memory package loader, followed by read-only filesystem inventory.
- Immutable tree and cross-object indexes.
- Structural schema validation.
- Base profile validation for document, heading, paragraph, image, text, and
  current marks.
- Manifest/head/change-chain validation.
- Accepted canonical-version index and history inspection.
- Projection/annotation/delegation/source reference validation.
- `dstar validate`, `dstar inspect`, and `dstar history`.

### Fixtures promoted from plan

- minimal valid package;
- document/hash/head mismatch;
- duplicate IDs and broken references;
- unsafe paths and links;
- invalid accepted chain including A -> B -> A history;
- invalid selectors/mappings; and
- unsupported declared profile preservation.

### Exit criteria

- Minimal package opens with zero errors.
- Every planned Core Reader fixture has a stable expected diagnostic code.
- The loader can inspect a malformed package without unsafe path access.
- Independent revision vectors match a second implementation or external test
  vectors.

## 6. Milestone 2 — Package writer and deterministic renderer

### Deliverables

- External runtime-root layout and SQLite adapter.
- Snapshot IDs, package lock, transaction journal, backups, and recovery.
- Fault injection at each transaction boundary.
- Base `RenderTree`, canonical React renderer, and DOM text-run descriptors.
- Deterministic HTML, Markdown, and plain-text projection plugins.
- Segment/source-map collector and reviewability validator.
- Safe asset route and HTML sanitizer.
- `dstar render`.

### Exit criteria

- Repeated deterministic renders are byte-identical across CI platforms.
- Crash injection leaves either old or new valid package after recovery.
- Canonical renderer produces stable node and text-run maps.
- Projection hashes, fragments, visible quotes, and canonical selectors verify.
- Unsafe HTML/assets have golden safe fallbacks.

## 7. Milestone 3 — Review client and annotations

### Deliverables

- Loopback workspace server, token authentication, API v1, and invalidation
  stream.
- React reader, review rail, document inspector, and diagnostics.
- Canonical and projection view adapters.
- DOM Range to Node/Segment selector conversion.
- Annotation creation, replies, resolve, audience, and computed resolution
  inbox.
- Human URL/file/citation source registration and safe source preview.
- File watching and stale snapshot handling.

### Exit criteria

- Playwright selects marked text, Unicode astral text, and cross-node text and
  creates the expected portable selectors.
- Comments survive refresh and package reopen without browser-only state.
- Projection comments copy canonical mappings exactly.
- Ambiguous/orphaned targets never receive a silent inline attachment.
- Canonical content has no direct edit path in DOM, API, or keyboard commands.

## 8. Milestone 4 — Change simulation and human decisions

### Deliverables

- Working-copy tree index and all six update operations.
- Historical version materializer using the same operation engine.
- Ordered preconditions and semantic diff.
- Applicable/stale/local-conflict/invalid simulation results.
- Proposal review UI.
- Human accept, reject, and supersede commands.
- `dstar show --version` and read-only version API endpoints.
- Canonical acceptance transaction and idempotency ledger.
- Projection invalidation and asynchronous regeneration.

### Exit criteria

- Every operation has golden before/change/after fixtures.
- Multi-operation failure mutates no portable file.
- Delete/move detect changed origin context.
- Same-parent move and Unicode text replacement behave identically across
  platforms.
- Human confirmation binds to exact snapshot and result revision.
- A successful accept advances `headChange`, preserves provenance, and leaves
  its motivating annotation open.
- Genesis and multi-update histories materialize every accepted version, detect
  corrupted intermediate results, and verify the head against `document.json`.

## 9. Milestone 5 — Agent runtime and genesis

### Deliverables

- Durable local jobs and provider-neutral adapter.
- Deterministic fake provider for tests.
- Context assembler with audience and semantic-neighborhood filtering.
- Brokered read and output tools.
- MCP stdio adapter with task-scoped resources and tools.
- Delegation queued/in-progress/terminal lifecycle.
- Proposal, reply, no-result, failure, cancellation, and repair paths.
- Local genesis draft, preview, rejection, and accepted materialization.
- Rebase-request agent flow.

### Exit criteria

- An agent cannot access filesystem, decisions, excluded comments, or network
  without a brokered capability.
- Model-supplied actor/status/hash values cannot override runtime values.
- MCP sessions cannot discover or invoke human decision commands or escape
  their package, actor, audience, task, snapshot, and budget capability.
- Delegation result and proposal/reply are persisted atomically.
- Stale inference output becomes a stale proposal, never an applied change.
- Genesis creates no completed package until explicit human acceptance.
- End-to-end north-star flow passes with the deterministic fake provider.

## 10. Milestone 6 — Interoperability and hardening

### Deliverables

- All planned conformance role fixtures as machine-readable cases.
- A fixture runner reusable by another implementation.
- Complete local API diagnostic documentation.
- MCP compatibility tests against a generic client and supported negotiated
  protocol versions.
- Referenced projection retention and regeneration recovery.
- Security corpus for paths, XSS, SVG/media, CSRF, prompt injection, and limits.
- Performance/scale measurements and configured limits.
- Provider adapter for the first real model behind the existing port.
- Release packaging and reproducible build documentation.

### Exit criteria

- A second independent reader validates the produced minimal package.
- The reference implementation passes every claimed role fixture.
- Security tests produce safe diagnostics without execution or package mutation.
- The north-star browser workflow passes with fake and real provider adapters.
- A package remains usable after runtime cache/database deletion.

## 11. Test layers

### Unit

- canonicalization, hashes, code-point conversions;
- path parser and IDs;
- tree indexes and operation algorithms;
- selector construction/resolution;
- profile rules and diagnostics; and
- mapping collector.

### Property

- parse/serialize preservation of unknown content;
- arbitrary safe paths never escape root;
- incremental tree index equals full rebuild;
- operation apply either returns a fully valid result or no result;
- target resolver never reports exact for non-matching quotation; and
- accepted change-ID chains remain ordered with repeated revisions; and
- historical materialization is deterministic with or without local
  checkpoints.

### Golden/conformance

- package fixtures with expected diagnostic codes;
- operation before/change/after triples;
- accepted-chain genesis/intermediate/head materialization results;
- renderer artifact bytes and indexes; and
- API read models for exact/recovered/ambiguous states.

### Integration

- lock, transaction, recovery, and external file watcher;
- annotation/delegation/proposal multi-file workflows;
- provider job persistence and cancellation; and
- render regeneration with referenced old projections.

### Browser E2E

- selection and comment on canonical/HTML views;
- discussion without delegation;
- delegation through proposed change;
- stale/conflict proposal UX;
- accept/reject/supersede/rebase paths; and
- accessibility keyboard flows.

## 12. CI gates

Every pull request must pass:

1. format and Markdown link check;
2. generated schema/type drift check;
3. lint and dependency-boundary check;
4. typecheck;
5. unit/property tests;
6. conformance fixtures for affected roles;
7. package integration tests; and
8. browser smoke tests when UI changes.

Nightly or release CI adds cross-platform renderer determinism, crash matrix,
full browser suite, dependency/security scan, fuzz corpus, and real-provider
contract smoke tests with spending limits.

## 13. First implementation backlog

The first build sequence after design approval is:

1. Create workspace and protocol package boundaries.
2. Generate TypeScript types from current schemas.
3. Implement I-JSON and RFC 8785 revision vectors.
4. Load `minimal.dstar` into an immutable in-memory snapshot.
5. Implement semantic node/history/reference validation.
6. Expose `dstar validate` with stable diagnostics.
7. Implement base canonical render tree and HTML output.
8. Implement canonical DOM text-run mapping.
9. Implement read-only workspace server and reader page.
10. Add canonical selection -> annotation as the first writable feature.

No real model provider is added before deterministic proposal fixtures and the
human decision boundary work end to end.

## 14. Risk register

| Risk | Early mitigation |
| --- | --- |
| Spec churn creates duplicate code models | Schema-generated types and fixture-first changes |
| Browser selection differs across renderers | Explicit DOM text maps and Playwright corpus |
| Multi-file writes leave partial package | External journal, recovery, crash injection |
| Rich content expands base scope too quickly | Implement only spec-complete types; profile adapters |
| Agent framework drives protocol design | Fake provider and narrow provider port first |
| Prompt injection bypasses task scope | Brokered tools, least context, deterministic validation |
| Projection provenance grows package indefinitely | Conservative retention now; design archive in spec later |
| Local-only assumptions leak into protocol | Runtime state outside package and dependency boundaries |

## 15. Decisions required before coding

These are implementation choices, not protocol questions:

- exact HTTP server library;
- SQLite adapter and supported native-build policy;
- JSON Schema/type-generation toolchain;
- RFC 8785 library versus audited local implementation;
- HTML sanitizer and SVG handling library;
- React build/application shell; and
- first real provider adapter.

Each choice gets a short ADR comparing security, portability, maintenance, and
bundle/runtime cost. None should delay pure core and fixture work.

## 16. Definition of 0.1 reference implementation complete

The implementation is complete when:

- it passes claimed Core Reader, Version Reader, Core Writer, Review Client,
  Delegation Client, Change Producer, Change Applier, and Projection Renderer
  fixtures;
- the full north-star workflow works from genesis through a second accepted
  update;
- every accepted canonical version in that workflow can be materialized and
  verified after deleting local caches;
- comments remain portable and safely unresolved through target ambiguity;
- deleting the runtime store does not lose portable state;
- a second implementation reads and validates its output;
- no direct human canonical editing path exists;
- documented security and crash tests pass; and
- unsupported capabilities are explicit rather than silently degraded.
