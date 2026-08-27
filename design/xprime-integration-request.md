# xPrime MCP Client Integration Request

Status: **Draft integration request**

## Goal

Use xPrime as the first real MCP client host for DSTAR without making xPrime or
its execution model part of the DSTAR protocol, SDK, package runtime, or MCP
contract.

DSTAR launches a stdio server already fixed to one document or genesis draft
and one human principal. xPrime discovers and invokes ordinary MCP tools. DSTAR
does not expose task discovery, executor assignment, run lifecycle, provider
configuration, or host-internal identity.

## Required baseline

xPrime only needs its existing MCP tool client to support the ten DSTAR tools:

```text
get_manifest       list_comments       get_node
search_document    get_annotation      get_source
simulate_update    submit_proposal     reply_comment
submit_genesis
```

Update calls include explicit `baseChange` and `baseRevision`; retryable writes
include an idempotency key. Proposal and reply authorship is recorded on behalf
of the fixed human principal. No tool accepts, rejects, supersedes, resolves,
assigns, or directly writes canonical content.

## Resources and Apps

Incremental Resource support should negotiate capabilities, list templates and
resources, read text/blob content, and expose URI/MIME metadata without loading
every resource by default. Resource reads must continue through xPrime's normal
MCP permission and lifecycle controls.

Future MCP App support should read declared `ui://` resources, enforce the
extension's CSP and permissions in a sandboxed frame, and route App tool calls
through the same MCP registry and approval controls. DSTAR will not package
canonical decision controls into an MCP App while the project rule forbids MCP
paths from accepting canonical content.

## Compatibility evidence

The repository's `check:xprime` script must exercise the real xPrime MCP client
boundary against a copied fixture, submit a pending proposal, verify canonical
head/revision remain unchanged, and then perform any human acceptance through
the separate workspace/SDK decision path. Host-specific APIs stay in this
integration check and never leak into portable schemas or public SDK types.
