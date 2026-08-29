# HTML-first MVP contract

Development format: `dstar-html-0.2-dev`. No claim of compatibility with
`spec/0.1` or a stable external SDK. See [architecture](architecture.md).

## Portable state

The root checkout holds the current accepted `document.html`, optional
`styles.css`, `styles/**/*.css`, and local `assets/**`. Before genesis is
accepted, these files do not exist in the destination package.
`.dstar/state.json` is a small commit header. Proposal/decision records and
comment threads live in separate JSON files; `.dstar/objects/<64 lowercase hex>`
contains immutable compressed objects. Copy the whole directory, not just the
checkout, to retain review history. Locks and recovery journals also live under `.dstar`
while operations are in progress; do not copy a package mid-write.

The metadata is collaboration/storage information, not a duplicate semantic
document source. There is no SQLite, Git executable or database service dependency.
Pre-HTML-first `document.json` packages remain unsupported.

### Directory metadata layout (`records-v1`)

```text
document.html
styles.css                         # optional
styles/                            # optional
assets/                            # optional
.dstar/
  state.json                       # small authoritative commit header
  proposals/00000000.json           # one proposal, decision and optional checkpoint
  proposals/00000001.json
  comments/00000000.json            # one comment thread, including replies
  objects/<64 lowercase hex>        # compressed immutable file blobs/deltas
  write.lock                       # only while an Engine operation holds the lock
  metadata-journal.json             # only during metadata updates/recovery
  journal.json                     # only during checkout updates/recovery
```

The header contains `format`, `storage: "records-v1"`, `id`, `generation`,
`head`, `proposalCount` and `commentCount`. It contains no proposal/comment arrays
and is capped at 4 KiB. Each collection uses zero-based, contiguous eight-digit
decimal filenames up to its committed count. A file contains the corresponding
proposal or comment JSON directly, including its stable UUID. The ordinal
preserves insertion order without a growing root index; it is not the public ID.
Record files are Engine-owned and must not be reordered or edited by hand.
Files beyond the committed counts are not read; a write refuses to overwrite an
untracked record at its next destination. Unknown files are never garbage-collected.

The Engine and CLI still expose the complete logical `State` with ordered
`proposals` and `comments` arrays. Physical storage fields do not enter the review
state hash. A reply updates its thread record, not all proposals or other threads;
accept/reject updates the affected proposal record. Existing replies remain
inside their thread rather than introducing a file per message.

Existing monolithic `dstar-html-0.2-dev` metadata remains readable without
conversion on inspection or idempotent retries. The next actual mutation converts
it under the same write lock and recovery protocol, preserving supported records,
IDs, order, revision hashes, review decisions, selectors and compressed objects.
Conversion is part of that mutation, not an extra generation. Older Engines
which require the monolithic arrays reject the new header: new Engines read old
bundles, but old Engines cannot read the new layout. Keep a pre-conversion
whole-directory backup if older Engines must remain usable. No user bundle is
batch-migrated on upgrade.

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

During replay, the Engine hashes each decoded file and reuses those verified
digests for unchanged files in subsequent revision manifests. Within one locked
operation it also reuses the already-verified head materialization. Neither
optimization skips object verification on the next operation or changes revision
hashes. This is not a persistent cache that can hide later object corruption.

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
storage before modifying checkout. A journal lists only changed canonical paths;
unchanged assets and stylesheets are not rewritten. Changed files
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

Metadata updates first durably write `metadata-journal.json`, containing hashes
of the exact before/after state headers (or legacy state) and before-images of
only changed records. New records use a null before-image. The Engine then
durably writes those records, atomically replaces `state.json` last, and removes
the metadata journal. Newly created record/object parent directories are also
synced. The journal format is `dstar-metadata-undo-v1`; record destinations are
restricted to bounded ordinals in the two metadata collections.

On reopen, metadata recovery runs **before** loading records or recovering the
checkout. If the authoritative state matches the before hash, it restores the
before-images and removes only journal-listed newly added record files. If it
matches the after hash, the new records are already committed. If neither hash
matches, recovery fails closed. Rollback is repeatable if recovery itself is
interrupted. The checkout journal then restores canonical files to the recovered
authoritative head.
When an existing record already equals its before-image, rollback syncs its
directory without allocating another full record file. A failed allocation
(for example ENOSPC) therefore does not prevent reopening unchanged metadata.
Different or missing records still require restoration; hardware errors or
insufficient space for a necessary restoration are not silently ignored.
Never delete either journal manually. Raw JSON readers, like raw HTML readers,
do not receive transactional guarantees during writes.

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
Each new preview capability obtains a freshly verified Engine snapshot. Its
HTML, styles and images then reuse those pinned bytes without reloading comments
or replaying history for every resource. The Viewer retains only files/revision,
not review metadata, with a 64 MiB payload budget and at most 100 capabilities;
oldest capabilities are evicted first and return 404 until refreshed. Closing
the Viewer clears the cache. An issued preview can still display its verified
bytes after disk contents change, but a fresh preview, current-state query or
accept/reject/resolve operation always uses the Engine's current checks. Cached
preview bytes never authorize a decision or bypass corrupt on-disk history.
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
depth 80; 10,000 proposals/comments; 64 MiB aggregate live metadata (header plus
record JSON). Undo journals are temporary, separately bounded, and may require
additional disk space. Limits reject new work
instead of discarding existing accepted versions. Reads/replay are synchronous
and intended for modest local packages. Directory scanning and DOM indexing
are not yet a hardened streaming implementation. Full `inspect` and current
mutations still load all metadata records and compare their serialized content;
this change bounds ordinary write amplification, not metadata read complexity.
Many small files can increase filesystem allocation and cold-open costs.
The Viewer avoids multiplying these costs by serving each preview's resources
from the same bounded, verified snapshot. Routine regression scenarios use
20–50 comment threads and a few assets, not thousands of comments.
Per-thread growth, pagination, packed metadata and retention remain future work.

No branches/merge, CRDT, hosted auth, assignment, automatic agents, pre-HTML migration,
retention/GC, arbitrary scripts, semantic CSS-rule diff or stable public API.
