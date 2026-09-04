# ADR 0001: Make HTML the single canonical document artifact

Status: **Accepted for redesign**

Date: 2026-08-27

## Context

The earlier DSTAR pre-draft stores a semantic JSON tree and derives HTML,
Markdown, summaries, and other projections. Extending that model to cover a
plain document, an unconstrained designed page, and a slide deck requires
different layout schemas, renderers, mapping layers, and regeneration rules.

AI agents can already author the complete HTML and CSS appropriate to each
experience. Maintaining a second semantic source duplicates visible content and
creates synchronization and fidelity problems. Keeping a complete projection
for every accepted version also risks linear storage growth.

The portable behaviors that remain valuable across all authored experiences
are stable comment anchors, proposal review, human decisions, provenance, and
verifiable history.

## Decision

DSTAR will use one canonical HTML presentation with declared CSS and assets.
HTML is both source and presentation. Doc-like pages, rich websites, and slide
decks are agent authoring conventions rather than separate protocol document
types.

Meaningful elements use stable `data-dstar-id` values. Comments target an
element and optionally a Unicode text range with quotation evidence.

Agents submit complete candidate packages against an exact base revision. The
system computes a human-readable DOM/CSS/asset diff and an independent compact
storage representation. Accepted history uses exact-base patches,
content-addressed objects, compression, and verified checkpoints; every logical
revision still represents a complete immutable document.

Package-authored executable scripts are outside the initial safe subset.
Trusted viewer behavior, such as slide navigation, is selected declaratively
and version-bound through the manifest.

This decision replaces the earlier semantic-JSON schemas, fixtures,
conformance roles and implementation.

## Consequences

Positive consequences:

- no duplicate semantic source and presentation;
- unrestricted safe HTML/CSS layout rather than one universal component model;
- one comment and version protocol for articles, pages, and slides;
- exact review of what will be accepted; and
- compact history without full-copy snapshots.

Negative consequences:

- HTML and CSS parsing, sandboxing, validation, and diffing become core;
- export to non-HTML formats is no longer guaranteed by a shared semantic tree;
- stable IDs must survive agent edits to preserve comments;
- arbitrary active web applications remain out of scope; and
- earlier pre-draft packages are unsupported by the HTML-first Engine.

## Alternatives considered

### One semantic JSON source with multiple projections

Rejected because the product requires one authored presentation rather than
several regenerated views, and because a universal source model constrains
HTML and slide layout.

### Separate Doc, HTML, and Slides JSON schemas

Rejected because it creates three content protocols while their collaboration
and final presentation substrate remain the same.

### Semantic JSON plus independently authored HTML

Rejected because meaningful content is duplicated and the two authorities can
diverge.

### Full HTML snapshot per accepted version

Rejected as the physical storage model because unchanged HTML, CSS, and assets
would grow linearly. Full revisions remain the logical model; compact deltas and
checkpoints are the physical representation.

## Verification

- article, rich-page, and slide-deck fixtures validate under one format;
- stable element and Unicode text comments recover across accepted changes;
- candidate preview bytes equal accepted materialized bytes;
- DOM/CSS/asset diffs explain complete candidates;
- exact-base patches and content-addressed objects materialize every recorded
  revision; and
- an independent implementation agrees on file-set revisions and history
  replay.
