# ADR 0002: Skill, independent Engine and Viewer

Status: accepted for the local HTML-first MVP; SDK publication timing superseded
by [ADR 0003](0003-host-owned-runtime.md).

Use an agent skill plus a small independent Engine/CLI and a Viewer.
The agent stages full HTML/CSS/assets; `propose` computes and stores revision,
review diff and compact delta before the Viewer is opened. Human review only
reads those results and delegates accept/reject persistence to the Engine.

Borrow exact-base deltas, content addressing and checkpoints from Git-like
designs without depending on Git or requiring a repository. Do not introduce a
new MCP layer or publish an SDK until a concrete integration needs it.

The HTML-first Engine does not silently load earlier JSON packages under its
contract. See [implemented limits](../html-mvp.md).
