# `@dstar/node`

Stability: **experimental**

Node-specific boundary for DSTAR package and runtime services. It depends on
`@dstar/core`; the reverse dependency is forbidden.

```ts
import { NODE_SDK_STABILITY } from "@dstar/node";
```

The `@dstar/node/testing` entrypoint is labeled **testing** and currently exposes
the `minimal.dstar` fixture loader. Production package opening and mutation are
Milestone 2 work and are deliberately absent here.
