# Security Design

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## Posture and trust boundaries

A `.dstar` package is untrusted document content, not an application bundle.
This is especially important because canonical content is now HTML and CSS.
Opening a package must not execute package code, escape its root, fetch remote
subresources, access workspace credentials, or mutate accepted state.

Untrusted inputs include package paths and bytes, HTML, CSS, assets, comments,
sources, patches, checkpoints, MCP arguments, and agent-generated candidates.
Trusted code includes the protocol core, package runtime, HTML/CSS parsers and
validators, sandbox bridge, review application, and authenticated human
decision controls.

## Package controls

The runtime rejects traversal, links, special files, duplicate JSON keys,
excessive files or bytes, decompression bombs, invalid content digests, broken
references, duplicate stable IDs, patch mismatches, and revision/history
inconsistency.

Content-addressed object names are verified from bytes before use. A checkpoint
is trusted only after complete materialization and revision verification.
Patches apply only to their exact base digest and never use fuzzy matching.

## Canonical HTML and CSS

Canonical presentation is parsed and validated before preview or acceptance.
The 0.1 safe subset forbids:

- scripts, inline event handlers, forms, popups, and top navigation;
- remote stylesheets, imports, fonts, media, frames, and network fetches;
- `javascript:`, `data:` active content, extension, and host-file URLs;
- active inline SVG, plugin content, and unsupported embeds;
- CSS capable of loading undeclared external resources; and
- meaningful text that exists only in generated CSS content.

Safe package-local images and media use validated paths, MIME allowlists,
bounded ranges, `nosniff`, and restrictive response headers. SVG is served as a
sandboxed image or attachment, never injected as trusted DOM.

## Browser isolation

The canonical document runs in a sandboxed frame with a restrictive CSP and no
workspace token. Review rails, proposal controls, and human decision UI live
outside that frame so package CSS cannot hide or imitate them.

The optional selection bridge has a narrow message schema. The host validates
frame origin/channel, snapshot token, stable element ID, range, and quotation
against its own parsed index. The frame cannot invoke package mutation or
decision commands.

Trusted slide navigation or other viewer behavior is application code selected
by a manifest runtime identifier. Package-authored JavaScript is not supported
in 0.1.

## Candidate boundary

An agent may submit a complete candidate, but it cannot declare its own output
safe, compute authoritative diffs, choose a human identity, or accept the
result. The service independently inventories, parses, validates, hashes,
diffs, and previews candidate bytes.

Unsafe candidates fail visibly. The acceptance UI binds the decision to the
exact candidate revision and uses the same validated bytes shown in the after
preview. There is no post-preview sanitizer that can alter accepted output.

## MCP and service controls

The workspace service binds to loopback, uses a high-entropy launch token,
validates Origin and CSRF state, rejects wildcard CORS, rate-limits mutations,
and returns sensitive content with `no-store`.

The stdio MCP process is fixed to one package or genesis draft and one human
principal. Tool arguments cannot select filesystem paths, identity, authority,
or wider scope. MCP exposes proposal production but no accept, reject,
supersede, resolve, or canonical-write tool.

## Untrusted instructions and secrets

HTML text, comments, source files, CSS strings, and captured evidence may
contain hostile instructions. DSTAR treats them as data. They cannot change
tool policy, grant authority, forge a human decision, or select credentials.

Secrets and provider credentials remain outside the package, candidate,
history objects, browser frame, MCP result, and logs. Logs contain IDs, byte
counts, timings, outcomes, and diagnostic codes rather than document bodies.

## Verification

Security tests cover path and symlink attacks, object/checkpoint corruption,
patch confusion, parser limits, HTML/CSS/URL payloads, SVG and MIME confusion,
sandbox escape, selection-bridge spoofing, loopback authentication, stale
writes, MCP scope, forbidden decision tools, provenance tampering, and
dependency/license auditing.
