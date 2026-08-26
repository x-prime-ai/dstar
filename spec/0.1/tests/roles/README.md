# DSTAR 0.1 role fixtures

`manifest.json` is the implementation-neutral fixture index. Each case names a
portable package, the roles exercised, supported profiles, and normalized
expected output. Implementations may use any language and runtime; they pass a
case when their normalized JSON output is I-JSON-equivalent to the named
`expected` file.

The reference TypeScript runner is `scripts/run-role-fixtures.mjs`. The
independent Python validator recomputes canonical document revisions without
importing DSTAR packages:

```text
pnpm build
node scripts/run-role-fixtures.mjs
python3 scripts/validate-reference-output.py
```

The fixture intentionally checks authority provenance: proposal authors are
agents and accepting decision actors are humans.
