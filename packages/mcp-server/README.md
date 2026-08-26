# `@dstar/mcp-server`

Stability: **experimental**

Pre-scoped MCP adapter for DSTAR document-delegation and genesis workflows.
It exposes only bounded reads, simulation, and agent-authored pending results;
human decision authority is intentionally absent.

The CLI launches a fixed stdio capability:

```text
dstar mcp document <document.dstar> --actor <agent-id>
dstar mcp genesis <draft> --actor <agent-id>
```

The public raw tool names are stable and xPrime-compatible. They contain no
filesystem, network, shell, annotation-resolution, or human-decision tool. Run
the optional real-host check against a local xPrime checkout after building
both projects:

```text
XPRIME_ROOT=/path/to/x-prime pnpm check:xprime
```
