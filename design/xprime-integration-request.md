# xPrime MCP Client Integration Request

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft integration request**

## Goal

Use xPrime as the first real MCP client host for canonical-HTML DSTAR without
making xPrime or its execution model part of the portable protocol, SDK,
package runtime, or MCP contract.

DSTAR launches a stdio server already fixed to one document or genesis draft
and one human principal. xPrime may ask an agent to produce a doc-like page,
rich website, or slide deck, but every result is the same bounded canonical HTML
package format.

## Required baseline

xPrime needs ordinary MCP tool support for:

```text
get_manifest       get_document        get_element
search_document    list_comments       get_annotation
get_source         simulate_candidate  submit_candidate
reply_comment      submit_genesis
```

Candidate calls carry complete HTML/CSS and admitted asset references together
with explicit `baseChange`, `baseRevision`, and idempotency key. The agent is
instructed to preserve stable `data-dstar-id` values for surviving elements.

No tool accepts, rejects, supersedes, resolves, assigns, changes identity, or
directly writes canonical files.

## Resources and Apps

Resource support should expose bounded canonical HTML, stable-element context,
styles, annotations, and source metadata without loading every asset by
default. Reads continue through xPrime's normal MCP permission and lifecycle
controls.

Future MCP App support should render the DSTAR review UI in its own sandbox and
the canonical document in a nested untrusted frame. App calls use the same MCP
registry and approval controls. Human acceptance remains outside the
proposal-only MCP surface.

## Compatibility evidence

The repository integration check must exercise the real xPrime MCP client
against a copied fixture, read a comment and relevant stable element, submit a
complete pending candidate, verify canonical head and revision remain
unchanged, and then perform human acceptance through the separate workspace or
SDK decision path. Host-specific IDs stay outside portable schemas.
