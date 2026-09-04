# DSTAR packages

[`@dstar/engine`](engine/README.md) is the server-side TypeScript SDK behind the
HTML-first CLI, Viewer and workspace services. It validates complete
HTML/CSS/asset candidates, stores exact revisions and compact history, and
records proposals and comments without a central DSTAR service.

The default entry point is agent-safe. Trusted human decisions live in the
explicit `@dstar/engine/host` subpath so a host can place its own authentication
and authorization boundary around them.
