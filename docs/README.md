# DSTAR documentation

DSTAR is a portable HTML document runtime. A host stores each document, owns
identity and authorization, and chooses whether to expose Core directly, MCP
tools, the reference Viewer, or a combination of them. No DSTAR-hosted service
is required.

## Start here

| Goal                                       | Guide                                      |
| ------------------------------------------ | ------------------------------------------ |
| Understand the data and concurrency model  | [Core concepts](concepts.md)               |
| Run the repository and create a document   | [Getting started](getting-started.md)      |
| Build a custom TypeScript integration      | [Core SDK](core-sdk.md)                    |
| Add DSTAR tools to an MCP server           | [MCP integration](mcp.md)                  |
| Self-host the review UI and browser WebMCP | [Viewer and WebMCP](viewer.md)             |
| Call the Viewer's HTTP endpoints           | [Viewer HTTP API](http-api.md)             |
| Use the local command line                 | [CLI reference](cli.md)                    |
| Choose and operate a deployment            | [Deployment and operations](deployment.md) |

## Choose an integration surface

| Product requirement                  | Use                          | What the host provides                                                         |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| Custom UI or workflow                | `@dstar/core`                | routes, identity, authorization and storage                                    |
| MCP tools in an existing product     | `@dstar/mcp` + `@dstar/core` | MCP transport, document lookup, identity and capabilities                      |
| Complete review UI                   | `@dstar/viewer`              | package storage, origin, TLS, credentials, routing and optional agent callback |
| Browser-agent tools in the review UI | Viewer WebMCP                | a browser with native WebMCP support; no separate server package               |
| Disposable review environments       | workspace service            | seed, wildcard routing, lifecycle policy and persistent volume                 |
| Local authoring and inspection       | CLI                          | local package and candidate directories                                        |

These surfaces share one Core document. MCP and WebMCP do not maintain parallel
document state.

## Package status

The TypeScript packages require Node.js 22 or newer and use ESM. Their manifests
are prepared for publishing, but the current version and artifact format are
pre-stable. Pin an exact release and test production data copies before
upgrading. The current on-disk format is `dstar-html-0.2-dev`.

The supported public packages are:

- `@dstar/core`: complete filesystem-backed document API.
- `@dstar/mcp`: caller-scoped MCP adapter for Core.
- `@dstar/viewer`: self-hosted Viewer and its browser WebMCP surface.

There is currently no separate remote HTTP client package. The documented HTTP
surface belongs to `@dstar/viewer`; custom services normally expose their own
API over `@dstar/core`.

## Reference and design material

- [Host integration contract](../integration/README.md)
- [Runnable examples](../examples/README.md)
- [Architecture and design records](../design/README.md)
- [Implemented format and limits](../design/html-mvp.md)
- [WebMCP security model](../design/webmcp.md)
- [Vision](../VISION.md)
