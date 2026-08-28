# Authoring and candidate workflow

## Create

Create a complete staged directory separate from the target package.
Choose layout based on the request; do not create a source JSON tree.
The examples in `examples/html-first` and `examples/slides-first` are optional
starting points, not mandatory designs.

```sh
pnpm dstar validate /absolute/path/candidate
pnpm dstar propose /absolute/path/document.dstar --candidate /absolute/path/candidate --base none --request "Create the requested document" --key unique-initial-key
pnpm dstar serve /absolute/path/document.dstar
```

The target must be new or empty. Genesis is a pending proposal, not an accepted
document. The Viewer displays the stored candidate even before genesis acceptance.

## Revise

1. Inspect the package and record its exact `revision` and relevant comments.
2. Export the accepted version to a new empty staging directory.
3. Edit staged HTML/CSS/assets, preserving unrelated content and surviving IDs.
4. Validate, then propose against the recorded base.
5. Review the Engine's computed summary and inspect the exact stored candidate
   in the Viewer at appropriate viewport widths.

```sh
pnpm dstar inspect /absolute/path/document.dstar
pnpm dstar export /absolute/path/document.dstar --out /absolute/path/candidate
pnpm dstar validate /absolute/path/candidate
pnpm dstar propose /absolute/path/document.dstar --candidate /absolute/path/candidate --base sha256:EXACT_INSPECTED_HASH --request "Address comment COMMENT_ID" --key unique-edit-key
```

Reuse a key only for an exact retry of the same base, candidate, author and
request. A different command under the same key fails. A stale base requires
re-reading the head and preparing a new candidate, never fuzzy patching.
The Engine chooses compressed deltas or blobs; the agent does not compute them.

## Review and handoff

Use the actual before/after previews to assess layout, overflow, text,
accessibility and assets. The persisted DOM summary is bounded (200 elements,
160-character text previews); it is not a complete visual diff.
Inspect changed files when a summary is insufficient. Large HTML redesigns may
store replacement blobs if compression beats the patch.

Surface removed IDs, rewrite ratio, recovered/ambiguous/orphaned comment anchors,
unexpected styling changes and any unverified visual behavior.
A comment-motivated edit should mention its comment ID in the request and may
receive a separate reply; acceptance and resolution remain human decisions.

For historical inspection or export, add `--revision <proposal-id-or-revision>`
to `inspect` or `export`. Never overwrite a nonempty export directory.
