# DSTAR static demo

Build the browser-local hackathon demo with `node deploy/static-site/build.mjs`.
The generated `dist/` tree includes the document library, four sample
documents, selection comments, replies, resolved threads, a simple current
version view, browser-local persistence, and WebMCP context/drafting tools.

This mode intentionally does not claim multi-user synchronization or durable
server-side storage. The full Viewer and Engine remain the product runtime for
those capabilities.
