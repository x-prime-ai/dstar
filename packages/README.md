# DSTAR packages

See the [public documentation index](../docs/README.md) for installation,
concepts and end-to-end integration paths.

[`@dstar/core`](core/README.md) is the server-side TypeScript SDK behind the
HTML-first CLI, Viewer and workspace services. It validates complete
HTML/CSS/asset candidates, stores exact revisions and compact history, and
records proposals and comments without a central DSTAR service.

The package exposes the complete document lifecycle. Authentication,
authorization and MCP tool exposure belong to the integrating application.

[`@dstar/mcp`](mcp/README.md) adapts that lifecycle to caller-scoped MCP tools.
The integrating product owns the transport, document selection, authentication
and capability policy; MCP calls Core rather than maintaining separate state.
