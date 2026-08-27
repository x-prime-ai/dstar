# `@dstar/core`

Stability: **experimental**

Platform-neutral DSTAR protocol primitives. This package has no filesystem,
Node.js, React, network, MCP, or model-provider dependency. Its experimental
surface includes:

- duplicate-key-aware, bounded I-JSON parsing;
- RFC 8785 canonicalization and SHA-256 revisions;
- generated structural validators and base-profile semantics;
- immutable document/package indexes and Unicode selectors;
- all six deterministic update operations and semantic diff;
- accepted-version materialization; and
- in-memory proposal, annotation, human assignment, and explicit human-decision
  helpers.

Public entrypoints:

```ts
import { DIAGNOSTIC_REGISTRY, SCHEMA_IDS } from "@dstar/core";
import type { Diagnostic } from "@dstar/core/diagnostics";
import { DocumentSchema } from "@dstar/core/schema";
```

Proposal builders always produce `status: "proposed"`. Pure acceptance helpers
require a human actor and an exact simulated result revision; proposal authors
are ordinary portable actors and receive no decision authority.

The schema namespaces are generated from `spec/0.1/schemas`. Run
`pnpm generate:schema-types` after changing a schema; CI rejects drift.
