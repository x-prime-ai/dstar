# Security Design

Status: **Draft**

## Posture and trust boundaries

A `.dstar` package is untrusted structured content, not an application bundle.
Opening one must not execute code, escape its root, fetch remote resources, or
mutate canonical content. Provenance is declared metadata, not a signature.

Untrusted inputs include package paths and bytes, canonical content, comments,
sources, stored projections, MCP arguments, and external client output. Trusted
code includes the protocol core, installed renderers/profiles, the local review
application, and authenticated human decision controls.

## Package and service controls

The package runtime rejects traversal, links, special files, duplicate JSON
keys, excessive sizes/depth/counts, invalid profiles, broken references, and
revision/history mismatches. It never constructs shell commands from package
data and uses expected snapshots, hashes, locks, and recoverable transactions.

The workspace service binds to loopback, uses a high-entropy launch token,
validates Origin and CSRF state, accepts bounded JSON only, rejects wildcard
CORS, rate-limits mutations, and returns sensitive data with `no-store`.

## MCP boundary

The stdio MCP process is launched for exactly one document or genesis draft and
one human principal. Tool arguments cannot select a filesystem path, identity,
authority level, or wider scope. Calls have expiry and byte/call budgets.

MCP exposes bounded reads, simulation, pending proposal submission, and comment
reply. It exposes no assignment, resolution, accept, reject, supersede, or
canonical-write tool. Tool metadata is not authorization; every call is
validated at the broker and package-command layers. The external client's
implementation type is irrelevant to DSTAR.

## Rendered content and assets

Stored HTML is sanitized and shown only in a sandboxed frame with scripts,
forms, popups, top navigation, remote connections, and active embeds disabled.
Selection attributes are checked against the projection index. Package content
receives no local API token.

Assets use opaque routes, snapshot/path revalidation, allowlisted MIME types,
`nosniff`, bounded ranges, and attachment disposition for active or unsupported
formats. SVG is never injected as trusted inline markup.

## Untrusted instructions and data minimization

Document and source text may contain hostile instructions. DSTAR treats it as
data: it cannot change tool policy, select identity, forge a human decision, or
bypass deterministic validation. Read surfaces are bounded, proposal arguments
are schema checked, and canonical changes always require an exact-diff human
decision.

Secrets and provider credentials are outside DSTAR. They are never stored in a
package, projection, source, change, runtime log, browser response, or MCP
result. Local logs contain IDs, sizes, timings, and diagnostic codes rather
than document bodies.

Annotation `audience` is disclosure metadata, not encryption. Filesystem access
can reveal package content. Implementations enforce requested disclosure scope
at their own presentation boundaries without treating it as cryptographic
access control.

## UI integrity

The review application labels pending versus accepted state, shows exact bases
and deterministic result revision, disables decisions for stale/invalid
simulations, names the deciding human, and has no auto-accept path. Proposal
creation and canonical decision remain separate commands even when initiated
from one user session.

## Verification

Security tests cover path/symlink attacks, parser and resource limits, HTML/SVG
payloads, loopback authentication, stale writes, MCP scope and budget failures,
forbidden decision tools, provenance tampering, idempotency mismatch, and
dependency/license auditing.
