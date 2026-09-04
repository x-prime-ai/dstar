# ADR 0003: Make the host own the DSTAR runtime

Status: **Accepted**

Date: 2026-09-03

## Context

An external product needs to display and review DSTAR documents at its own
origin, with its own persistence, identity and operational controls. Requiring
that product to load a DSTAR-operated website or send documents to a central
DSTAR backend would make DSTAR a service dependency rather than a portable
document system.

The repository already contains a filesystem Engine, a complete Viewer and a
browser WebMCP surface. Their public integration boundary was implicit: the
Engine package was marked private, trusted decisions used an internal module
name, and deployment documentation described an implementation more than a
host contract.

## Decision

DSTAR integrations are host-owned by default.

- `@dstar/engine` is the server-side TypeScript SDK. Its root entry point is the
  agent-safe API for snapshots, proposals, comments, replies and exports.
- `@dstar/engine/host` is the explicit trusted-host authority for accepting or
  rejecting proposals and resolving comments. The importing server must enforce
  human authentication and authorization.
- `@dstar/viewer` is a self-hostable Node.js review UI and browser WebMCP
  surface. It operates on one host-owned package and has no central DSTAR
  dependency.
- The reference container is a deployable composition of those packages, not a
  requirement to use DSTAR infrastructure.
- WebMCP tools are registered by the host's Viewer page in the user's browser.
  DSTAR does not require a separately hosted MCP server.

Each package and browser origin has one clear owner. The host owns routing,
identity, credential delivery, TLS, persistence, backup, monitoring and release
pinning. DSTAR owns validation, immutable revision semantics, proposal history,
comment targets and reference review behavior.

## Consequences

Positive consequences:

- document content and review history remain on infrastructure chosen by the
  integrating product;
- the product can use the complete Viewer or build a custom UI on the same
  typed Engine contract;
- no DSTAR service availability, account or network dependency exists; and
- agent integration works through either the server-side SDK/CLI or browser
  WebMCP at the host's origin.

Negative consequences:

- every host must operate storage, secrets, TLS, backups and upgrades;
- the current filesystem runtime supports one writer process, not horizontal
  autoscaling;
- authentication adapters remain host-specific and outside the core package;
  and
- pre-1.0 hosts must pin versions while the development format evolves.

## Rejected alternatives

### Central DSTAR document service

Rejected because it makes portability operationally false and forces hosts to
delegate data residency, identity and availability.

### Host-specific adapters in this repository

Rejected because they couple the core contract to one product. Product-specific
routing, auth and deployment code belongs in that product's repository.

### MCP server as the primary integration surface

Rejected because hosting and human review still require storage, identity and a
browser experience. MCP may be an adapter, but it is not the document runtime.

## Verification

- package tarballs contain their declared runtime, public assets and TypeScript
  declarations;
- an external TypeScript consumer compiles against only documented exports;
- the reference Viewer starts from explicit host configuration and serves a
  host-owned package without external network calls; and
- repository documentation contains no product-specific integration contract.
