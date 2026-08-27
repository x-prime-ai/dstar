# `@dstar/mcp-server`

Stability: **experimental**

Pre-scoped MCP adapter for one DSTAR document or genesis draft. It exposes
bounded reads, deterministic simulation, pending proposals, and comment replies
on behalf of a fixed human principal. Human decision authority is intentionally
absent.

The CLI launches a fixed stdio capability:

```text
dstar mcp document <document.dstar> --principal <human-id>
dstar mcp genesis <draft> --principal <human-id>
```

The ten public tools contain no filesystem, network, shell, assignment,
resolution, task-lifecycle, or canonical-decision operation. A caller supplies
explicit change/revision bases when simulating or submitting an update.

Hosts that negotiate MCP Resources can list and read scoped `dstar://` JSON
resources. Resource discovery is fixed to the launched document or draft;
Resources never widen tool authority. Hosts without Resources use the same
tool-complete contract.

Run the optional real-host check against a local xPrime checkout after building
both projects:

```text
XPRIME_ROOT=/path/to/x-prime pnpm check:xprime
```

Current host evidence and the MCP App packaging gate are recorded in
[`compatibility/README.md`](../../compatibility/README.md).
