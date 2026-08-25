# DSTAR 0.1 Specification

Status: **Pre-Draft**

This document is the normative entry point for DSTAR 0.1. The specification is
incomplete and must not yet be used to claim production compatibility.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
indicate requirement levels when written in uppercase.

## 1. Scope

DSTAR defines a portable, reviewable document object consisting of:

- a small semantic document model;
- a directory package encoding;
- durable annotation threads;
- reviewable, revision-aware changes;
- sources, actors, assets, and provenance; and
- addressable projections with mappings to canonical content.

DSTAR does not define an editor UI, collaboration transport, database, CRDT,
model provider, authentication system, or hosting service.

## 2. Architecture

A DSTAR package has one canonical document and four connected non-content
layers:

```text
canonical document
    <- annotations and review state
    <- proposed changes and decisions
    <- sources and provenance
    <- projections and source mappings
```

Annotations and changes refer to canonical nodes by durable ID. A projection is
derived, but it has its own ID and revision so a person can review it. Projection
segments map back to the canonical nodes from which they were derived.

## 3. Package

An unpacked DSTAR document MUST be a directory whose name ends in `.dstar`.

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

Required entries:

- `manifest.json` identifies the specification version, content profiles,
  current canonical revision, and package entry points.
- `document.json` contains the canonical document tree.

Optional entries:

- `annotations/` contains one annotation thread per JSON file.
- `changes/` contains one proposed or decided change per JSON file.
- `sources.json` contains source records.
- `assets/` contains package-local binary or textual resources.
- `projections/` contains derived views; when present it MUST contain
  `index.json`.

The working representation is the directory package. A ZIP transfer encoding
MAY use the filename suffix `.dstar.zip`; its deterministic packing rules are
not yet normative in 0.1.

Package paths MUST be relative, use `/` as the serialized separator, and MUST
NOT escape the package root. Implementations MUST NOT follow package-local
links that escape the root while validating or extracting a package.

## 4. Structural and semantic validity

A structurally valid package conforms to the JSON Schemas in `schemas/`.

A semantically valid package additionally satisfies all cross-object and
behavioral requirements in this specification, including identifier uniqueness,
reference integrity, projection mapping integrity, revision preconditions, and
authority rules.

The JSON Schemas are authoritative for structural validity. The normative prose
is authoritative for semantics and behavior.

## 5. Identity

Every document, node, annotation, reply, change, change operation, projection,
and projection segment MUST have an identifier unique in its required scope.
Identifiers are opaque strings. Implementations MUST NOT derive meaning, order,
or location from an identifier.

Moving a node within a document MUST NOT change its identifier. Editor-internal
positions, CRDT identifiers, and transient content hashes MUST NOT replace DSTAR
identity.

## 6. Content profiles

Every package MUST declare at least one content profile in `manifest.json`.
DSTAR 0.1 defines the profile identifier `dstar:base` for the node and inline
model in [Document Model](document-model.md).

Additional profiles MAY define new node types, marks, attributes, containment
rules, or projection roles. Profile identifiers are opaque strings in 0.1 and
SHOULD be globally unique URIs when published by third parties.

An implementation that does not understand a declared profile MUST report that
limitation. A lossless processor MUST preserve unknown profile content.

## 7. Revisions

A canonical document revision identifies the exact `document.json` value.
DSTAR 0.1 revision identifiers use this algorithm:

1. Parse `document.json` as I-JSON.
2. Serialize the parsed value using the JSON Canonicalization Scheme defined by
   RFC 8785.
3. Compute SHA-256 over the UTF-8 canonical bytes.
4. Encode the identifier as `sha256:` followed by 64 lowercase hexadecimal
   digits.

Formatting-only changes to `document.json` therefore do not change its
revision. An asset has separate integrity and is not included in the 0.1
document revision unless its digest is represented in canonical node data.

A change MUST declare the canonical revision against which it was authored. An
implementation MUST NOT silently apply it to a different revision. Operations
also carry local preconditions so a processor can report precise conflicts.

Projection revisions use the same `sha256:` encoding over the projection's raw
file bytes. They are distinct from canonical document revisions.

## 8. Actors and authority

An actor has a stable identifier and one of these types:

- `human`
- `agent`
- `service`

Agent-authored changes MUST begin in the `proposed` state. An agent MUST NOT be
recorded as the sole decision maker accepting its own change.

Authorization policy is implementation-defined, but authorship, motivation,
and decision provenance are portable package data.

An annotation MAY declare an intended audience. This is a context-disclosure
instruction for conforming tools, not an encryption or filesystem security
boundary.

## 9. Component specifications

- [Document model](document-model.md)
- [Annotations](annotations.md)
- [Changes](changes.md)
- [Projections](projections.md)

## 10. Implementation conformance

An implementation MAY claim one or more roles:

- **Core Reader** — reads and validates the manifest and canonical document.
- **Review Client** — reads and writes annotation threads and resolves targets.
- **Change Producer** — creates structurally and semantically valid proposals.
- **Change Applier** — verifies and atomically accepts or rejects proposals.
- **Projection Renderer** — generates indexed projections and source mappings.

A conformance claim MUST name the DSTAR version, role, supported content
profiles, and any unsupported optional capabilities. Passing JSON Schema alone
is not sufficient; role-specific behavioral fixtures under `tests/` are also
required once published.

## 11. Extensions

Unknown object properties beginning with `x-` are extension properties.
Implementations SHOULD preserve extension properties during lossless reads and
writes. New semantic types SHOULD be introduced by a declared profile rather
than by an uncoordinated `x-` property.

Unknown node, mark, annotation, or operation types from a declared profile MUST
be preserved by lossless processors. Renderers MUST emit a diagnostic or visible
fallback instead of silently dropping meaningful content.

## 12. Versioning

The manifest field `dstar` identifies the specification version. A 0.x version
is experimental and may introduce breaking changes.

Within a future stable major version, minor versions may add fields and types
that older readers are required to preserve, while major versions may make
backward-incompatible changes.

## 13. Open issues

- Deterministic ZIP packing rules and a packed media type
- Asset integrity and its relationship to canonical revision
- Profile discovery and registry policy
- Cross-node inline selections
- Event-log and archival representation for complete audit history
- Conformance fixtures and required error codes for each role
