# Evidence and Assets

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## 1. Purpose

Sources explain where claims or proposed work came from. Assets are canonical
presentation resources referenced by HTML or CSS. Both are portable, but only
declared presentation assets participate in the document revision.

Source registration, source capture, candidate authoring, and human acceptance
remain separate actions. Registering evidence never accepts a document change.

## 2. Source model

`sources.json` is a portable registry of URL, captured file, and citation
records indexed by stable source ID.

- A URL source records its address, title, and access metadata; registration
  does not imply fetching or permanence.
- A captured file source references a content-addressed package object and
  records safe display metadata.
- A citation source records portable bibliographic fields defined by the
  eventual specification.

Agents may cite only sources exposed by the caller's context policy. External
research and package registration happen through separately authorized
capabilities.

## 3. Canonical asset model

Images, fonts, video, audio, and data files used by `document.html` or declared
styles are canonical presentation assets. Each asset record includes:

```ts
interface AssetRecord {
  id: AssetId;
  digest: Digest;
  size: number;
  mediaType: string;
  object: PackagePath;
  displayName?: string;
}
```

HTML and CSS refer to a stable package asset URL resolved through this record.
The document revision binds the referenced asset digest, not merely a mutable
path.

Content-addressed bytes are stored once even when several accepted versions or
several asset IDs reference them.

## 4. Candidate assets

A genesis or update candidate may include new bounded asset objects. Candidate
validation:

1. inventories bytes outside the accepted package state;
2. computes digest, size, and detected media type;
3. rejects links, traversal, unsupported or active content, and size violations;
4. validates every HTML/CSS reference against the candidate asset index;
5. previews through opaque staged URLs; and
6. installs accepted objects and references atomically.

An agent cannot smuggle a host path or remote resource into the package.

## 5. Versioning and retention

Asset additions, removals, and reference changes appear in the proposal diff.
Unchanged objects are reused by digest. Removing an asset from the current
document does not delete its object while an accepted historical revision,
checkpoint, captured source, or pending proposal still references it.

Garbage collection is reachability-based:

```text
current head
+ accepted history
+ retained checkpoints
+ pending proposals
+ source records
    -> reachable object digests
```

GC is an explicit maintenance operation with a dry run. It never infers
unreachability from HTML filenames alone.

## 6. Integrity and serving

The runtime rehashes an object's bytes before first use in a snapshot and after
any external file event. A digest mismatch makes the package inspect-only.

The browser never receives host filesystem paths. Safe assets are served
through opaque snapshot-bound URLs with explicit MIME, range limits,
`X-Content-Type-Options: nosniff`, and restrictive CSP. Unsupported active
formats download as attachments. External navigation always requires an
explicit safe link and human action.

## 7. Tests

- URL, captured-file, and citation source registration;
- candidate asset staging and atomic acceptance;
- digest deduplication across versions;
- HTML and CSS reference validation;
- MIME confusion, SVG, oversized media, and decompression bombs;
- historical materialization after current asset removal;
- reachability analysis and dry-run garbage collection; and
- out-of-band object modification invalidating the package.
