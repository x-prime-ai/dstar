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

Hosts that negotiate MCP Resources can list templates and read scoped
`dstar://document`, `dstar://annotation`, `dstar://source`, and
`dstar://projection` JSON resources. Resource discovery mirrors the fixed
actor/audience filter used by tools. Modern `subscriptions/listen` and legacy
resource updates are supported when the package remains below the bounded
watch set. At larger scale the server advertises `subscribe: false`; list/read
and all tool workflows remain available.

Resources are an optimization, not an authority path. Hosts without Resource
or App support use the same eleven tool-complete operations. No Resource or
tool can accept, reject, supersede, resolve, or otherwise make a human
canonical-content decision.

Current host evidence and the explicit MCP App blocker are recorded in
[`compatibility/README.md`](../../compatibility/README.md).
