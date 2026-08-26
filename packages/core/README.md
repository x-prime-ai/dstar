# `@dstar/core`

Stability: **experimental**

Platform-neutral DSTAR protocol types and diagnostics. This package has no
filesystem, Node.js, React, network, MCP, or model-provider dependency.

Public entrypoints:

```ts
import { DIAGNOSTIC_REGISTRY, SCHEMA_IDS } from "@dstar/core";
import type { Diagnostic } from "@dstar/core/diagnostics";
import { DocumentSchema } from "@dstar/core/schema";
```

The schema namespaces are generated from `spec/0.1/schemas`. Run
`pnpm generate:schema-types` after changing a schema; CI rejects drift.
