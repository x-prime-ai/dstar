# DSTAR packages

The public SDK surface is intentionally small and uses explicit package exports.

- `@dstar/core` is platform-neutral and may be imported by browsers, workers,
  Node.js, and other TypeScript runtimes.
- `@dstar/node` owns Node-specific integration and depends inward on
  `@dstar/core`.

Every documented export has a stability label:

- **experimental** — public in 0.x, but may change with a documented release;
- **stable** — compatibility is maintained within the declared major version;
- **testing** — public only for conformance and fixture infrastructure; and
- **internal** — not exported from a package and may change without notice.

Only paths listed in a package's `exports` map are public. Importing `src/`,
`dist/`, or another undeclared deep path is unsupported. The MCP SDK, filesystem,
network, React, and provider dependencies must never be reachable from
`@dstar/core`.
