# ADR 0002: Skill, independent Engine and Viewer

Status: accepted for the local HTML-first MVP.

Use an agent skill plus a small independent Engine/CLI and a Viewer.
The agent stages full HTML/CSS/assets; `propose` computes and stores revision,
review diff and compact delta before the Viewer is opened. Human review only
reads those results and delegates accept/reject persistence to the Engine.

Borrow exact-base deltas, content addressing and checkpoints from Git-like
designs without depending on Git or requiring a repository. Do not introduce a
new MCP layer or publish an SDK until a concrete integration needs it.

The new development format is separate from legacy `spec/0.1`. Preserve the old
implementation during this transition; do not silently load old JSON packages
under the HTML-first contract. See [implemented limits](../html-mvp.md).
