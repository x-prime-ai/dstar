# Renderer

Status: **Draft**

## 1. Purpose

The render system converts canonical semantic content into human and machine
views without changing authority. It produces:

- an in-memory canonical HTML view whose selection targets `document`;
- stored, versioned projections and their source maps;
- safe asset responses; and
- visible fallbacks and diagnostics for unsupported content.

The renderer never writes canonical content and never repairs unsupported nodes
by dropping or rewriting them.

## 2. Render pipeline

```text
PackageSnapshot
    -> profile capability check
    -> semantic RenderTree
    -> target-specific renderer
       canonical HTML | HTML projection | Markdown | text | summary | machine context
    -> mapping collector
    -> output validation and sanitization
    -> artifact bytes + projection record + diagnostics
```

`RenderTree` is an internal immutable view of DSTAR nodes, inline runs, resolved
assets, and supported profile behavior. It retains DSTAR IDs and never adopts
DOM IDs or framework keys as semantic identity.

## 3. Profile registry

```ts
interface ProfileAdapter {
  profileId: string;
  validateNode(node: DstarNode, context: ProfileContext): Diagnostic[];
  toRenderNode(node: DstarNode, context: ProfileContext): RenderNode;
  supportedNodeTypes: ReadonlySet<string>;
  supportedMarkTypes: ReadonlySet<string>;
}
```

The registry is explicit for each render request. A renderer records the exact
adapter versions in its local cache key and generator version.

The initial `dstar:base` adapter renders only node types with complete 0.1 spec
rules. Encountering another reserved-but-undefined base type is an unsupported
capability diagnostic, not permission to invent semantics.

Third-party adapters are trusted code installed by the user or application.
Packages cannot load executable profile code by declaring a profile URI.

## 4. Unsupported content

Unsupported nodes render as an accessible fallback containing:

- node type and stable ID;
- a statement that content is unsupported;
- safely escaped textual fields or a bounded JSON inspector; and
- a diagnostic reference.

Unknown marks preserve their text and display a warning in inspection mode.
They are not silently treated as a known mark. Unsupported content remains in
the canonical tree and any lossless round trip.

## 5. Canonical view

The canonical view is generated from the current `document.json` on demand. It
is not stored in `projections/index.json` and has no projection revision.

The same semantic rendering pipeline may render a verified historical
canonical materialization for inspection. That result is labeled with its
accepted change ID and content revision and MUST NOT be presented as the current
canonical view. It is an ephemeral application view, not a stored projection or
an alternate source of truth.

### 5.1 Output contract

The render result contains:

```ts
interface CanonicalViewModel {
  documentRevision: Revision;
  reactTree: ReactNode;
  nodeOrder: NodeId[];
  nodeElements: Map<NodeId, ElementHandle>;
  textRuns: CanonicalTextRunDescriptor[];
  diagnostics: Diagnostic[];
}
```

Semantic elements carry `data-dstar-node`. Registered text runs map DOM text
back to node-local canonical code-point intervals as described in
[Review client](review-client.md).

### 5.2 Mark rendering

- `strong` -> `<strong>`
- `emphasis` -> `<em>`
- `code` -> `<code>`
- `link` -> sanitized `<a>` with safe scheme and `rel="noopener noreferrer"`

Mark nesting is deterministic: the base renderer uses canonical mark-array
order without silently merging or reordering marks. DOM nesting does not affect
the canonical text stream; profile validation decides whether a particular
combination is supported.

### 5.3 Layout text

Whitespace, list markers, captions generated from metadata, and visual labels
are marked non-canonical in the text-run map. CSS generated content is never
used as the only presentation of meaningful canonical text.

## 6. Projection plugins

```ts
interface ProjectionPlugin<Request> {
  mediaType: string;
  role: string;
  render(input: {
    snapshot: PackageSnapshot;
    request: Request;
    profileRegistry: ProfileRegistry;
  }): Promise<RenderedProjection>;
}

interface RenderedProjection {
  bytes: Uint8Array;
  segments: ProjectionSegment[];
  extension: string;
  diagnostics: Diagnostic[];
}
```

Initial plugins:

- base HTML reading projection;
- Markdown export;
- plain-text projection;
- rule-based summary placeholder for deterministic tests;
- machine-context projection assembled by caller policy.

Non-deterministic summaries use a service generator actor and are invoked by an
external application, not disguised as deterministic renderer output.

## 7. Segment and source-map construction

The mapping collector creates a segment before emitting its corresponding
meaningful output. Each segment has:

- stable-within-projection segment ID;
- projection selectors over final output;
- one or more canonical selectors; and
- exact, transformed, or summarizes relations.

### 7.1 Plain text and Markdown

The emitter writes to a code-point-aware buffer that tracks output start/end
positions. It records quotation after final emission and verifies the indexed
slice exactly matches it.

Markdown syntax usually makes a segment `transformed`; plain visible text may
remain `exact` when byte/text output matches the canonical range.

### 7.2 HTML

The renderer assigns `data-dstar-segment` before serialization. It derives
quotation from the same semantic visible-text model used to emit DOM content,
then verifies the sanitized output still contains the fragment and expected
visible text.

The mapping is never reconstructed from CSS selectors, XPath, or child indexes.

### 7.3 Cross-node mappings

An exact cross-node mapping uses `NodeRangeSelector` and the canonical LF range
normalization in the annotation spec. `viewExact` is recorded when the emitted
view uses different separators. A transformed or summarized segment uses the
smallest reliable node or range without inventing partial offsets.

## 8. Reviewability validation

Before setting `reviewable: true`, a plugin must prove:

- every meaningful selectable output region belongs to at least one segment;
- every segment selector resolves uniquely in the final artifact;
- segment order matches reading order;
- every canonical selector resolves at `generatedFromRevision`;
- exact quotes match; and
- unsupported content is visibly mapped rather than omitted.

If proof fails, the artifact may still be stored as non-reviewable. The renderer
does not weaken mappings to make validation pass.

## 9. HTML safety

The base HTML plugin creates markup from safe render primitives; it does not
concatenate arbitrary canonical strings into HTML.

Final HTML is sanitized with an allowlist:

- semantic document tags, tables, figures, code, and safe media as supported;
- `data-dstar-segment`, language, accessibility, and constrained class attrs;
- safe `http`, `https`, `mailto`, and package-asset URLs for links as policy
  permits; and
- no scripts, inline event handlers, forms, `javascript:` URLs, external
  stylesheets, untrusted iframes, or active SVG embedding.

Projection CSS is generated by the trusted theme. User CSS is not supported in
0.1. Stored SVG assets are served as images with restrictive response headers,
not inserted into the application's live DOM.

## 10. Asset resolution

The renderer resolves canonical asset paths through `PackageRepository`; it
does not join strings with the host filesystem root.

For each asset it verifies:

- normalized package-relative path and non-symlink regular file;
- configured size limit;
- declared or detected media type;
- supported use at the target node; and
- presence in the candidate snapshot.

The local service serves assets at opaque, token-protected URLs keyed by
snapshot and validated package path. It sends `X-Content-Type-Options: nosniff`
and a restrictive Content Security Policy.

Missing or unsafe assets render a visible fallback and diagnostic. They never
cause a renderer to fetch a same-named external URL.

## 11. Determinism

Given the same:

- canonical revision;
- declared profile adapter versions;
- plugin and theme versions;
- render request; and
- package asset bytes,

a deterministic plugin must emit identical artifact bytes and segment records.
It controls newline convention, attribute order, JSON formatting, and locale.
Timestamps live in generator metadata and are supplied to the render operation;
they do not vary during retries.

Non-deterministic projections are not required to be byte-deterministic, but
their stored bytes, generator actor, creation time, revision, and mappings are
fixed once published.

## 12. Projection identity and retention

Regeneration handles referenced and unreferenced projections differently.

### Unreferenced projection

When no annotation targets its projection ID/revision, a renderer may reuse the
projection ID and replace its artifact/index record in one projection
transaction.

### Referenced projection

The 0.1 reference implementation does not overwrite or delete its artifact or
record. It creates a new projection ID and artifact for the new canonical
revision, retains the old indexed projection, and marks the newest compatible
projection as preferred in the application read model.

This intentionally favors portable provenance over compactness until the spec
defines a versioned projection archive. The package may therefore contain
several reading projections with the same role. “Preferred” is computed locally
from generated revision/time and is not protocol authority.

Segment IDs may be reused only within a different projection scope and only
when semantic purpose remains unchanged. An annotation still identifies its
original projection ID and revision.

## 13. Regeneration transaction

1. Open a strict snapshot and choose requested plugins.
2. Render all requested outputs to memory or external staging.
3. Validate raw revisions, selectors, mappings, paths, and safety.
4. Build a candidate projection index preserving referenced old records.
5. Commit artifacts and index through one package transaction.
6. Reopen and validate the package.
7. Invalidate browser projection and target-resolution caches.

A document acceptance does not wait for this process. Until it succeeds, stale
projections remain labeled and the canonical view remains current.

## 14. Machine-context rendering

Machine context is a projection policy, not a dump of the package. It:

- includes only requested semantic nodes and necessary ancestors;
- applies annotation audience filtering;
- preserves stable IDs and canonical selectors;
- marks omitted regions and unsupported objects explicitly;
- separates instructions from untrusted content/source text; and
- carries manifest head/revision and task provenance.

It may be ephemeral rather than stored when no human review targets it. If
stored as a reviewable projection, it follows all projection index rules.

## 15. Failure behavior

- Unsupported profile: canonical fallback, projection diagnostic.
- Unsafe asset/link: omit active behavior, render fallback, preserve canonical.
- Incomplete mapping: projection becomes non-reviewable or generation fails.
- Sanitization changes meaningful text: generation fails.
- Hash/index mismatch after write: transaction recovery and projection failure.
- Plugin crash: no package write; other views remain usable.

## 16. Tests

- Golden output bytes and projection indexes for every deterministic plugin.
- Source-map slice verification for text, Markdown syntax, HTML marks, images,
  and cross-node ranges.
- Unsupported profile fallback and lossless preservation tests.
- XSS corpus and unsafe URL/media fixtures.
- Asset path, MIME confusion, SVG, and oversized-file tests.
- Referenced projection retention and unreferenced replacement tests.
- Repeated render determinism across operating systems and locales.
- Accessibility snapshots for headings, links, figures, code, and fallbacks.
