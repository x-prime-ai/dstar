# TypeScript host integration

This compile-checked example consumes only DSTAR's public package exports. It
shows the two integration seams a host needs:

- `serveDocument()` starts the complete Viewer at a host-owned origin.
- `acceptProposal()` maps a host-authenticated Owner into the exact-state trusted
  decision API.

The example is intentionally not an auth framework or deployment template.
Session lookup, role assignment, route protection, package selection and secret
storage belong to the integrating product.

See the [host integration contract](../../integration/README.md) before wiring
these functions into an application.
