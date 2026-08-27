# DSTAR 0.1 Specification

Status: **Pre-Draft**

This document is the normative entry point for DSTAR 0.1. The key words
**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** indicate
requirement levels when written in uppercase.

## 1. Scope

DSTAR defines a portable, reviewable document object consisting of:

- a semantic document model and directory package encoding;
- durable annotation threads with optional human assignment;
- revision-aware genesis and update proposals;
- explicit human decisions and accepted canonical version history;
- sources, actors, assets, and provenance; and
- addressable projections with mappings to canonical content.

DSTAR does not define an editor UI, collaboration transport, database, CRDT,
model, provider, workflow runtime, task system, authentication system, or
hosting service. The implementation that invokes an SDK or MCP adapter is not a
portable DSTAR actor or package object merely because it performed the call.

### 1.1 Terminology

- **Canonical document** is the authoritative source stored in
  `document.json`.
- **Canonical version** is one accepted point in history, identified by its
  accepted change ID and exact content revision.
- **Canonical view** is a faithful, read-only rendering of current canonical
  content.
- **Projection** is a derived, versioned view such as HTML, Markdown, a summary,
  or plain text.
- **Annotation** is a portable discussion thread attached to a precise target.
- **Assignee** is the human currently responsible for an annotation.
- **Proposal** is an immutable requested canonical transformation that remains
  non-canonical until separately accepted.

## 2. Architecture

```text
canonical document
    <- annotations, replies, and human assignment
    <- proposals, human decisions, and accepted history
    <- sources and provenance
    <- projections and source mappings
```

Assignment, proposal, annotation, and decision lifecycles are independent.
Assigning or replying to a comment does not mutate canonical content. Submitting
a proposal does not resolve its motivating annotation.

## 3. Package

An unpacked DSTAR document MUST be a directory ending in `.dstar`:

```text
example.dstar/
├── manifest.json
├── document.json
├── annotations/
│   └── ann_*.json
├── changes/
│   └── change_*.json
├── sources.json
├── assets/
└── projections/
    ├── index.json
    └── ...
```

`manifest.json`, `document.json`, and `changes/` are required. Annotation,
source, asset, and projection entries are optional. When an optional collection
exists, its manifest entrypoint MUST be present.

Package paths MUST contain non-empty `/`-separated segments. They MUST NOT be
absolute, contain `.` or `..` segments, contain `\` or `:`, or escape the
package root. Implementations MUST NOT follow package-local links during
validation or extraction.

## 4. Validity

Structural validity is defined by JSON Schemas in `schemas/`. Semantic validity
additionally requires identifier uniqueness, reference integrity, profile
validity, projection mapping integrity, revision preconditions, and authority
rules in this specification.

Every package MUST contain exactly one accepted genesis change. Accepted
changes MUST form an unbroken change-ID chain ending at `manifest.headChange`.
The head result revision MUST equal `manifest.revision` and the computed
revision of `document.json`.

The schemas are authoritative for structure. Normative prose is authoritative
for cross-object semantics and behavior.

## 5. Identity and actors

Document, node, annotation, reply, change, operation, projection, and segment
identifiers are opaque. Implementations MUST NOT derive order or location from
them. Moving a node MUST NOT change its identifier.

DSTAR 0.1 actor types are:

- `human` — a person represented by the surrounding authenticated system; and
- `service` — a named software service when service attribution is meaningful.

The actor model intentionally has no model-, provider-, runtime-, or
executor-specific actor type. A tool operating for a person records that person
as the author. Local systems MAY retain additional execution audit data outside
the package.

An annotation assignee MUST be a human. A proposal author MAY be any valid
DSTAR actor. A portable proposal decision and annotation resolution MUST name a
human actor.

## 6. Content profiles

Every package MUST declare at least one content profile. DSTAR 0.1 defines
`dstar:base` in [Document Model](document-model.md). Unknown declared-profile
content MUST be preserved losslessly by tools claiming preservation support;
unsupported behavior MUST be reported rather than guessed.

## 7. Canonical revisions

Canonical revisions use `sha256:` followed by lowercase SHA-256 of RFC 8785
canonical JSON bytes. Node preconditions use the same algorithm over the target
node. Projection revisions hash raw artifact bytes.

Canonical content changes only through acceptance of a proposal. Out-of-band
file modification produces an invalid package when recorded revisions no longer
match; the format does not claim cryptographic tamper proof.

## 8. Proposal and decision boundary

A producer creates a proposed genesis or update change. A separate authorized
human action accepts, rejects, or supersedes it. A conforming proposal surface
MUST NOT also expose acceptance under the same capability.

Acceptance of an update MUST atomically:

1. verify bases and ordered local preconditions;
2. apply all operations to an isolated working copy;
3. validate the result against declared profiles;
4. record the human decision and result revision; and
5. write canonical content plus manifest head/revision together.

Detailed semantics are in [Changes](changes.md).

## 9. Annotations and assignment

Annotations preserve what a person reviewed through stable targets, quotations,
and projection mappings. An optional `assignee` identifies a human responsible
for the thread. Assignment does not start software, create a task, grant
authority, or constrain how the human performs the work.

Detailed semantics are in [Annotations](annotations.md).

## 10. Projections

Projections are derived and never canonical. Reviewable projections MUST map
selectable meaningful regions back to canonical targets. Regeneration MUST
preserve original review provenance and MUST NOT silently reattach ambiguous
targets.

Detailed semantics are in [Projections](projections.md).

## 11. Conformance roles

An implementation MAY claim one or more roles:

- **Reader** — opens, validates, and exposes package objects.
- **Version Reader** — materializes accepted canonical versions.
- **Review Client** — creates annotations, replies, human assignments, and
  human lifecycle decisions.
- **Change Producer** — creates structurally and semantically valid proposals.
- **Change Applier** — simulates proposals and commits explicit human decisions.
- **Projection Renderer** — creates derived artifacts and mappings.
- **Preserver** — round-trips unknown declared-profile and `x-` data.

Conformance claims MUST identify the role, DSTAR version, supported profiles,
and test suite version.

## 12. Security

Package content, annotations, sources, and projections are untrusted input.
Implementations MUST enforce path containment, bounded parsing, safe rendering,
and explicit capability checks. Audience metadata is disclosure intent, not
filesystem access control.

Proposal-only SDK or MCP surfaces MUST NOT expose accept, reject, supersede,
resolve, arbitrary path access, shell execution, or unrestricted network
operations.

## 13. Related normative documents

- [Document model](document-model.md)
- [Annotations](annotations.md)
- [Changes](changes.md)
- [Projections](projections.md)
