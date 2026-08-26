# Evidence and Assets

Status: **Draft**

## 1. Purpose

Sources explain where claims or agent work came from. Assets provide
package-local resources used by canonical content or projections. Both are
portable, but neither is canonical document content by itself.

The first implementation must distinguish:

- registering source metadata;
- capturing a durable source file;
- adding a presentation/content asset;
- referencing evidence from a proposal; and
- fetching external content for an agent job.

None of these actions implicitly accepts a canonical change.

## 2. Source model

The base spec supports URL, file, and citation source records. The reference
implementation treats `sources.json` as a portable registry indexed by source
ID.

### URL source

Stores title, URL, and access time. Registration does not fetch the URL. A URL
source is evidence metadata, not proof that its content remains unchanged.

### File source

References a validated package-relative regular file, normally under:

```text
assets/sources/<source-id>/<safe-filename>
```

The file is copied into the package; it never points to an absolute host path.
Its source record survives moving the package.

### Citation source

Stores the base citation title and extension metadata allowed by the current
schema. Rich bibliographic fields require a future profile rather than hidden
runtime-only data.

## 3. Human source import

The UI and CLI support explicit source registration:

```text
dstar source add-url <package> <url> --title <title>
dstar source add-file <package> <file> --title <title>
dstar source add-citation <package> --title <title>
```

The workflow:

1. Human selects source type and input.
2. Service validates actor, snapshot, limits, and path/URL syntax.
3. File input is copied to external staging and scanned as untrusted bytes.
4. Service allocates stable source ID and safe package path.
5. Candidate `sources.json` and staged file are validated.
6. Package repository commits them in one evidence transaction.

Registering evidence is not canonical authorship, so it does not use a change
proposal. The current portable source schema does not record who registered a
source; the local command audit records that actor until the spec gains source
provenance fields.

## 4. Agent source access

Agents can read only source IDs admitted by context policy or returned through
an authorized search/read tool. Source content is labeled untrusted and bounded.

The first implementation allows proposals to reference only source IDs already
present in the task's package snapshot. It does not let a model silently add a
URL or package file while producing a proposal.

An explicitly authorized external-research capability may later:

1. fetch through the protected network broker;
2. show the fetched origin and content summary to the human;
3. register a new source in a separate package transaction; and
4. run a new proposal attempt against the resulting snapshot.

This sequencing keeps proposal sources resolvable and avoids making provider
network behavior part of change application.

## 5. Asset model

Assets are regular package files under `assets/`. The canonical document refers
to them through validated package-relative paths. Projection artifacts may also
refer to assets through paths that resolve within the package.

The runtime records derived local metadata such as detected media type, byte
size, dimensions, and cached preview. Unless represented in the protocol,
derived metadata is disposable and not portable authority.

## 6. Asset creation

### Genesis

Human-selected or agent-generated assets are staged with the genesis draft.
Acceptance materializes the files together with the first canonical document.
The preview uses staged assets through opaque runtime URLs.

### Updates

DSTAR 0.1 has no portable operation for adding, replacing, or deleting an asset.
The reference Change Producer therefore cannot propose a canonical node that
references a new asset path during an update. It may insert or modify an image
only when the referenced asset already exists.

An implementation-only side channel for new assets would make the proposal
non-portable and is prohibited. Asset mutation must be designed in the spec
before this capability is added.

## 7. Retention and deletion

The reference implementation never automatically deletes source records or
assets.

- A source referenced by any retained change must remain.
- A file source record and its package file are retained together.
- An asset referenced by current canonical content must remain.
- An asset used by a retained projection may remain necessary for review
  provenance.
- An apparently unreferenced asset may still be meaningful to an unknown
  declared profile, so automatic garbage collection is unsafe.

Manual maintenance initially offers inspection only. Portable deletion rules
wait for asset digests, profile reference enumeration, and update operations in
the spec.

## 8. Integrity and freshness

The canonical document revision includes an asset path but not the asset bytes.
Until the spec defines asset digests:

- the runtime hashes asset bytes into its snapshot ID and caches;
- an out-of-band asset edit invalidates the package snapshot;
- the UI reports that canonical revision alone does not bind asset content;
- render output revision binds the actual projection bytes but not necessarily
  every separately served asset; and
- provenance must not claim cryptographic evidence integrity.

URL sources likewise have no content digest. `accessedAt` is descriptive only.

## 9. Preview and serving

The browser never receives host filesystem paths. Source files and assets are
served through token-protected snapshot URLs after repository validation.

- Safe images/media may render with explicit MIME and size policy.
- Text/PDF source preview uses dedicated safe viewers.
- HTML and unsupported formats download as attachments.
- SVG is never injected inline.
- External URL navigation requires a human click and safe-link policy.

## 10. API boundary

Read operations:

```text
GET /sources
GET /sources/:id
GET /assets/metadata?path=<package-path>
GET /content/:snapshot-token/:opaque-id
```

Commands:

```text
POST /sources/url
POST /sources/file
POST /sources/citation
```

Every command includes expected snapshot, human actor, and idempotency key.
There is no asset-delete or source-delete command in 0.1.

## 11. Security controls

- Source files use package path, size, type, and special-file validation.
- File import reads only the explicitly selected file, not sibling directories.
- Filenames are sanitized for package storage while original display name stays
  in metadata where supported.
- URL registration rejects credentials and control characters.
- Fetching, when enabled, blocks private networks, unsafe redirects, oversized
  responses, and unsupported schemes.
- Source bodies never become system instructions.
- Previews cannot access the workspace API or provider secrets.

## 12. Tests

- URL/file/citation registration and duplicate-ID handling.
- File import path containment and crash recovery.
- Source references from genesis and update proposals.
- Proposal rejection for missing or newly invented source/asset IDs.
- Out-of-band asset modification invalidating snapshot/render cache.
- SVG/HTML/MIME-confusion safe preview behavior.
- Retention when current content, changes, or projections refer to a source or
  asset.

## 13. Required future spec work

- Asset record with media type, digest, size, and stable identity.
- Change operations for asset add/replace/delete.
- Portable source registration actor and capture provenance.
- Source content digest and snapshot semantics.
- Citation profile with structured bibliographic fields.
- Reference enumeration for unknown profiles and safe garbage collection.
