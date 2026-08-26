# Package Runtime

Status: **Draft**

## 1. Responsibilities

The package runtime is the reference implementation's trusted filesystem
boundary. It is responsible for:

- opening an unpacked `.dstar` directory without following unsafe paths;
- producing immutable, validated snapshots;
- preserving unknown declared-profile and `x-` data;
- serializing package writes;
- making multi-file mutations recoverable;
- detecting out-of-band changes; and
- keeping non-portable runtime data outside the package.

No other component reads or writes package paths directly.

## 2. Filesystem model

The runtime accepts an absolute path to a directory ending in `.dstar`. Before
reading protocol data it resolves and records the package root itself, then
uses descriptor-relative operations where the platform permits.

For every package entry it:

1. parses the serialized path using DSTAR package-path rules;
2. rejects absolute paths, URI-like paths, drive prefixes, backslashes, empty
   segments, and `.` or `..` segments;
3. checks every existing path component with `lstat`;
4. rejects symbolic links, junctions, device nodes, sockets, and named pipes;
5. opens only regular files and directories below the recorded root; and
6. verifies the resolved target remains below the root before use.

Symlinks are rejected even when they currently resolve inside the package. This
avoids time-of-check/time-of-use changes and keeps archives portable.

## 3. Runtime limits

Limits are configurable but the reference defaults are:

| Resource | Default |
| --- | ---: |
| Total unpacked package size | 256 MiB |
| Single JSON file | 8 MiB |
| Single projection artifact | 32 MiB |
| Single asset | 128 MiB |
| JSON nesting depth | 128 |
| Canonical nodes | 100,000 |
| Annotation threads | 50,000 |
| Replies per thread | 10,000 |
| Changes/delegations | 50,000 each |
| Package path length | 1,024 bytes |

Opening above a limit produces a diagnostic and no writable snapshot. A CLI
flag may raise limits for trusted packages; the browser never raises them
implicitly.

## 4. Open pipeline

```text
resolve package root
    -> safe recursive inventory
    -> locate manifest and required entries
    -> read bounded bytes
    -> parse JSON as I-JSON
    -> structural schema validation
    -> construct indexes
    -> profile + semantic validation
    -> verify revisions/history/references
    -> produce immutable PackageSnapshot
```

### 4.1 I-JSON parsing

The parser rejects:

- duplicate object keys;
- invalid Unicode scalar sequences;
- non-finite or out-of-range JSON numbers;
- trailing non-whitespace bytes; and
- a byte-order mark unless the spec later permits one.

Objects retain their parsed value for protocol logic and their original bytes
when lossless copying of unknown content is required. New or modified JSON is
written as UTF-8 with two-space indentation and a trailing newline; revisions
still use RFC 8785 canonical bytes.

### 4.2 Indexes

The snapshot builds immutable maps for:

- nodes and parent/sibling relationships;
- annotation and reply IDs;
- delegation IDs;
- change IDs and accepted-chain links;
- projection and segment IDs;
- sources; and
- asset paths.

Duplicate IDs are reported before references are resolved so diagnostics remain
deterministic.

### 4.3 Validation modes

- `strict` opens only semantically valid packages for mutation.
- `inspect` returns a read-only snapshot with diagnostics where safe parsing is
  possible.
- `repair-preview` may propose explicit repairs but never writes them.

The browser uses `strict` for commands and may use `inspect` to show a damaged
package. Agent execution and change acceptance require `strict`.

## 5. Snapshot identity

`snapshotId` is runtime-only. It is SHA-256 over a sorted inventory of each
portable file's normalized relative path, file type, size, and raw-byte hash.
It includes assets and projection artifacts, not only canonical content.

Two snapshots with the same canonical revision can therefore differ when a
comment, delegation, proposal, projection, or asset changes. Commands carry the
snapshot ID they were created from to prevent lost updates at the application
layer.

The manifest `revision` and `headChange` remain the protocol-level canonical
state. `snapshotId` is never serialized into a `.dstar` package.

## 6. Local runtime store

Each opened package receives a runtime key derived from its resolved root and
manifest document ID. Under `<runtime-root>/packages/<runtime-key>/`, the
implementation stores:

```text
runtime-key/
├── lock.json
├── transactions/
├── backups/
├── cache/
└── runtime.sqlite
```

`runtime.sqlite` uses WAL mode and contains:

- durable agent jobs and attempts;
- provider request IDs and usage metadata;
- command/idempotency execution records;
- verified historical-version materialization cache metadata;
- render and validation cache metadata;
- package-open history needed for recovery; and
- redacted structured events.

Portable objects are not authoritative database rows. The database may cache
their indexes, but reopening and validating package files can rebuild them.

Historical canonical materializations are cached by document ID, target
accepted change ID, result revision, and accepted-chain fingerprint. A cache
hit is usable only after the target remains on the validated accepted chain and
the cached tree recomputes to the recorded result revision. Cache deletion never
removes portable version history.

## 7. Locking

Package writes use an exclusive advisory lock stored in the runtime store, not
inside the package. Lock acquisition uses an atomic create or platform lock and
records:

- runtime key and package root;
- random lock token;
- process ID and process-start fingerprint;
- creation and heartbeat times; and
- intended command and transaction ID.

A lock is not considered stale from time alone. The runtime confirms that the
recorded process no longer exists or cannot own the process-start fingerprint
before recovery. Breaking an unverifiable lock requires explicit user action.

Readers use immutable snapshots without retaining the lock. Immediately after
acquiring a write lock, the repository reopens the inventory and verifies the
command's `expectedSnapshotId`.

## 8. Mutation model

Application services submit logical mutations rather than paths:

```ts
interface PackageCommit {
  expectedSnapshotId: SnapshotId;
  transactionType:
    | "genesis"
    | "annotation"
    | "delegation"
    | "evidence"
    | "proposal"
    | "decision"
    | "accept-change"
    | "projection";
  writes: ReadonlyMap<PackagePath, Uint8Array>;
  deletes: ReadonlySet<PackagePath>;
  expectedCurrentHashes: ReadonlyMap<PackagePath, Sha256 | "absent">;
}
```

The repository independently verifies that the requested path set is legal for
the transaction type. For example, an annotation transaction cannot write
`document.json`, and only an accepted-change transaction may change canonical
content and `manifest.headChange` together.

## 9. Recoverable multi-file commit

Portable filesystems do not provide an atomic rename of a populated directory.
The runtime therefore implements a journaled transaction and treats atomicity
as a conforming-reader guarantee: cooperating readers never receive a partial
snapshot, and a crash is recovered before the package is reopened.

### 9.1 Prepare

1. Acquire the package lock.
2. Reopen and compare `expectedSnapshotId` and expected file hashes.
3. Validate every proposed new byte sequence in an in-memory candidate snapshot.
4. Create a transaction directory in the external runtime store.
5. Write staged new files, original-file backups, and a journal containing
   target paths plus old/new SHA-256 hashes.
6. Flush staged files and the journal to durable storage when supported.

### 9.2 Install

1. Mark the journal `installing`.
2. Rename each existing target to its transaction backup.
3. Rename each staged file to its target; install the manifest last for a
   canonical acceptance transaction.
4. Apply declared deletions by moving them to the backup area.
5. Flush affected directories.
6. Reopen and validate the installed package.
7. Mark the journal `committed`, record the new snapshot ID, and release lock.

The service publishes the new snapshot only after step 6. Projection
regeneration is a separate transaction and is not part of canonical acceptance.

### 9.3 Recovery

On package open, any non-terminal journal is recovered before validation:

- If every target has its recorded new hash, finish the commit and validate.
- If every target has its recorded old hash, mark the transaction rolled back.
- Otherwise restore all old files from backups, verify their hashes, and mark
  the transaction rolled back.
- If neither completion nor rollback can be verified, refuse writes and emit a
  recovery-required diagnostic with the journal location.

Backups are retained until the new package has been reopened successfully at
least once. Cleanup never runs while a lock or recovery journal is active.

## 10. Single-object updates

Annotations, delegations, proposals, and decisions still use the transaction
machinery even when only one file changes. The runtime writes a complete new
snapshot file and renames it; it never edits JSON in place.

Reply creation and annotation resolution both compare the current annotation
file hash so concurrent snapshot edits fail rather than overwrite each other.
DSTAR 0.1 has no automatic merge for two annotation snapshots.

## 11. Canonical acceptance transaction

An accepted update transaction must include exactly:

- the new `document.json`;
- the same change record with terminal human decision metadata;
- `manifest.json` with matching `revision` and `headChange`.

The candidate snapshot must prove:

- the old manifest matches the proposal bases;
- ordered operation simulation produces the proposed document;
- the proposed result revision matches the decision;
- the accepted change extends the current accepted head;
- every declared profile validates; and
- all asset references resolve after the candidate transaction.

The 0.1 update vocabulary cannot add or delete asset files. Genesis may stage
initial assets; later asset mutation waits for a portable spec operation.

Projection artifacts are allowed to remain at their previous
`generatedFromRevision` temporarily. They are exposed as stale, never as current.

## 12. File watching and external edits

The watcher observes the package root but does not trust event payloads. After a
debounce it builds a new safe inventory.

- Events caused by the active transaction are coalesced into its new snapshot.
- A valid external edit creates a new snapshot and invalidates browser commands.
- A semantically invalid edit puts the workspace in read-only inspect mode.
- A changed `document.json` without a matching accepted head is reported as an
  authority/provenance violation; the runtime does not synthesize a change.
- Running agent inference may finish, but its output retains its original bases
  and will be stale when submitted.

The runtime never watches or serves paths reached through symlinks.

## 13. Caching

Cache keys include all semantic dependencies:

- validation: snapshot ID + validator version + supported profiles;
- canonical render: document revision + renderer/profile/theme versions;
- projection render: canonical revision + projection request + renderer version;
- target resolution: target value + current revision + mapping revision; and
- agent context: starting snapshot ID + task + context-policy version.

Cache output is disposable. A cache hit never bypasses current path, authority,
or precondition validation before a write.

## 14. Diagnostics

Package diagnostics use stable families:

```text
PKG_PATH_*       unsafe or missing filesystem entry
JSON_*           parsing or I-JSON violation
SCHEMA_*         structural schema failure
PROFILE_*        unsupported or invalid content profile
REF_*            missing or inconsistent cross-object reference
REV_*            revision/hash mismatch
HISTORY_*        invalid accepted change chain
AUTH_*           actor or authority violation
TXN_*            lock, commit, or recovery failure
LIMIT_*          configured resource limit exceeded
```

Diagnostics include protocol object IDs and JSON Pointers where safe. Absolute
local paths appear only in local logs, not portable package records.

## 15. Test strategy

- Golden package inventories for valid and invalid path structures.
- Property tests for path parsing and root containment.
- Crash injection after every transaction step.
- Concurrent writer tests using stale snapshot IDs and file hashes.
- Round-trip tests preserving unknown profile and `x-` content.
- Hash vectors for document, node, projection, and raw-file revisions.
- External-edit tests that move a workspace between valid and inspect-only
  states.
