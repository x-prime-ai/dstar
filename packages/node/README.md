# `@dstar/node`

Stability: **experimental**

Node-specific boundary for DSTAR package and runtime services. It depends on
`@dstar/core`; the reverse dependency is forbidden.

```ts
import { PackageCommands, PackageRepository, openPackage } from "@dstar/node";
```

The production entrypoint exposes safe package opening, immutable snapshots,
recoverable filesystem transactions, runtime idempotency, package commands,
genesis drafts, and portable version reads. Canonical decisions require a human
actor; proposal-result commands can only add agent-authored proposed changes.

The `@dstar/node/testing` entrypoint is labeled **testing** and exposes the
`minimal.dstar` fixture loader.
