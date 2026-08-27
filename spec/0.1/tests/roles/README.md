# DSTAR 0.1 role fixtures

`manifest.json` is the implementation-neutral fixture index. Each case names a
portable package, the roles exercised, supported profiles, and normalized
expected output. Implementations may use any language and runtime; they pass a
case when their normalized JSON output is I-JSON-equivalent to the named
`expected` file.

Each case is self-describing. `roles` selects the normalized role results that
must be emitted, while `exercise` supplies portable inputs rather than relying
on IDs built into a runner:

- `review` selects an annotation and canonical target;
- `update.operation` supplies an operation template whose `nodeRevision` is
  computed from the input package;
- `update.proposal` fixes the proposal author, provenance, and deterministic time;
- `update.decision` fixes a separate human decision actor and time; and
- `projections` lists the deterministic renderer kinds to exercise.

Runners MUST reject unknown roles, missing exercise inputs, profile mismatches,
or unavailable targets. They MUST preserve the declared proposal author and
human decision actor independently.

The reference TypeScript runner is `scripts/run-role-fixtures.mjs`. The
independent Python validator recomputes the normalized output, including the
update result, exact review target, authority provenance, and deterministic
base-profile render output, without importing DSTAR packages:

```text
pnpm build
node scripts/run-role-fixtures.mjs
python3 scripts/validate-reference-output.py
```

The fixture intentionally checks authority provenance: proposal submission and
acceptance remain distinct records, and accepting decision actors are humans.
