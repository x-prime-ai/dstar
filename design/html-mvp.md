# HTML-first MVP contract

Development format: `dstar-html-0.2-dev`. No claim of compatibility with
`spec/0.1` or a stable external SDK. See [architecture](architecture.md).

## Portable state

The root checkout holds the current accepted `document.html`, optional
`styles.css`, `styles/**/*.css`, and local `assets/**`. Before genesis is
accepted, these files do not exist in the destination package.
`.dstar/state.json` records format, package ID, generation, head proposal ID,
proposals/decisions and comments. `.dstar/objects/<64 lowercase hex>` contains
immutable compressed objects. Copy the whole directory, not just the checkout,
to retain review history. Locks and a recovery journal also live under `.dstar`
while operations are in progress; do not copy a package mid-write.

The metadata is collaboration/storage information, not a duplicate semantic
document source. Old packages are rejected, never automatically reinterpreted.

## Revision and storage encoding

`digest(bytes)` is `sha256:` plus lowercase SHA-256 hex. The revision hashes the
UTF-8 JSON serialization of:

```text
["dstar-static-v1", [[path, digest(rawBytes), byteLength], ...]]
```

Paths are unique, ASCII, slash-delimited, relative and sorted lexicographically.
All canonical files, including unused local assets, participate. Comments and
storage representation do not affect the document revision. The fixed profile
identifies current presentation/selection conventions; the browser engine,
platform font availability and viewport are not pinned for pixel identity.

Each changed file records path, exact base/result digest (null for missing),
result byte length and optional storage. Storage contains encoding, digest of
compressed bytes and compressed size. Encoding is either `gzip-blob` or
`gzip-delta-v1`. A delta decompresses to JSON:

```json
{ "version": 1, "ops": [{ "copy": [0, 64] }, { "insert": "aGVsbG8=" }] }
```

Copy offsets/lengths refer to exact base **bytes**. Inserts are base64 bytes.
The generator scans 64-byte matches with rolling checksums and verifies bytes
before copying. It uses a delta only when its gzip size plus 32 bytes is smaller
than the gzip replacement. This is not Git's pack/diff format and calls no Git.

Replay checks compressed hash/size, base digest, bounded decompression, result
digest/size, and the full revision at every applied step. The accepted chain is
linear. Pending proposals can share a base; after one is accepted, siblings are
stale and must be prepared again. Rejected proposals remain inspectable.

Every 20th accepted proposal stores a full checkpoint manifest referencing
compressed blobs. Identical objects reuse their content address. Checkpoints
bound ordinary replay depth; original changes are retained so removing a
checkpoint manifest permits genesis replay. Broken checkpoints fail closed;
there is no automatic repair or garbage collection.

The checkout is one full current copy. History avoids full copies for small
edits, but replacement blobs, checkpoints, comments and metadata still consume
space. Review summaries store at most 200 changed elements with 160-code-point
text previews, lengths and hashes, rather than full HTML/text on every revision.
All changed file manifests and aggregate element-change counts remain recorded.

## Write and recovery contract

`propose` validates the complete staged candidate, verifies current base,
generates storage objects and review summary, then atomically records a pending
proposal. The staging directory must be separate from the package. An exact
retry key returns its previous proposal; changed arguments under that key fail.

Acceptance verifies proposal, exact candidate, current state hash and parent
head under an exclusive `.dstar/write.lock`. It replays and validates candidate
storage before modifying checkout. A journal lists only canonical paths; files
are installed before the authoritative state file is atomically replaced.
Both installation and recovery remove obsolete journal-listed files first,
prune only empty affected directories, then write target files. File/directory
path transitions are supported; unrelated directory contents are never
recursively removed.
An interrupted operation is recovered according to the authoritative old or
new head on the next Engine open. The Engine never serves a hybrid checkout.
External raw-file readers are not transactional and may observe an install.

Writes fsync files and parent directories. A crashed process may leave a lock.
The MVP does **not** steal locks automatically: inspect its PID, verify no writer
is running, remove only `.dstar/write.lock`, and reopen. Do not delete a recovery
journal. Unexpected out-of-band checkout changes fail closed; the Engine does
not silently incorporate them into history.

## Comments

A target is `{revision, element, selector}`. Element selectors use
`{type:"element"}`. Text selectors use `type:"text-range"`, zero-based start/end,
`unit:"unicode-code-point"`, exact quote and optional prefix/suffix.

`dom-text-v1` uses HTML5 parsing (including CR/CRLF normalization, leading LF
handling in pre elements and browser tree construction), then concatenates
decoded descendant text nodes in DOM order. Canonical bytes are not rewritten.
It omits
hidden, aria-hidden=true, head and style subtrees; it does not collapse
whitespace, invent separators for br/block elements or inspect computed CSS
visibility. The browser bridge converts UTF-16 boundaries into code points.
Selections must stay within one nearest stable element in this MVP.

Creation validates the exact quote at the original revision. Recovery keeps
the original target and first checks that same element/range, then searches
exact quote plus optional context within the same element using a linear-time
code-point matcher. One match is
recovered; multiple are ambiguous; none are orphaned. The Viewer shows original
quotes/revisions and current-head status. No cross-element guessing occurs.
Replies do not resolve, and acceptance does not auto-resolve comments.

## Presentation and security profile

- Static HTML; one html/body; meaningful text requires a stable-ID ancestor.
- Visible images require their own ID and nonempty alt. Supported assets:
  PNG/JPEG/GIF/WebP and WOFF/WOFF2, with basic signature checking.
- No scripts, inline event handlers, forms, SVG, canvas, iframe, remote
  subresources, unsafe paths, symlinks or special files.
- CSS supports common layout/style declarations and media/supports/container/
  layer/keyframes/font-face. Imports, comments, escapes, remote URLs and
  meaningful generated `content` are rejected rather than rewritten.
- Relative local assets only. HTTPS links may be authored but outbound
  navigation is blocked by the selection bridge in the Viewer.
- Slides use body `data-dstar-mode="slides"` and sections marked
  `data-dstar-slide`; a trusted bridge shows one section at a time. Exported
  HTML remains readable as a stacked deck. No automatic slide scaling/fullscreen.

The Viewer uses a sandbox without allow-same-origin, a nonce-authorized trusted
bridge, restrictive CSP and no package-authored scripts. Host chrome and
decision controls are outside the content frame. Frame capabilities grant only
immutable preview reads. A separate session token gates APIs; POST also requires
the exact configured Origin and JSON content type. The default is a loopback
origin and ephemeral token; the session URL is a local secret. The optional
[persistent runtime](../deploy/viewer/README.md) requires host-provisioned
credentials and a single explicit HTTPS external origin for non-loopback
binding. Host and Origin are never inferred from forwarded headers; all
Forwarded/X-Forwarded-* headers are rejected. The fixed package root is set at
startup, not selected by a request. This does not add multi-user identities.
Accept stays disabled until the trusted bridge acknowledges the current frame
capability and exact revision after page, stylesheet, image and font checks.
All canonical assets are checked, including backgrounds and hidden slides.
An iframe load event alone is insufficient: HTTP error pages also emit it.
Resource failure or a 20-second timeout requires a fresh preview before accept.

This is defense-in-depth for a local prototype, not a multi-tenant security
claim. A trusted local process with filesystem access can bypass workflow
boundaries. Broader browser-conformance testing, signed identities, strict metadata
schemas and larger adversarial/scale corpora are future hardening work.

## Current caps and limitations

512 canonical files, 8 MiB per file, 32 MiB total and indexed text; 2,048 directory entries; 30,000 parsed HTML nodes and
depth 80; 10,000 proposals/comments; 64 MiB metadata. Limits reject new work
instead of discarding existing accepted versions. Reads/replay are synchronous
and intended for modest local packages. Directory scanning and DOM indexing
are not yet a hardened streaming implementation.

No branches/merge, CRDT, hosted auth, assignment, automatic agents, migration,
retention/GC, arbitrary scripts, semantic CSS-rule diff or stable public API.
