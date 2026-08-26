# Security corpus

This corpus is data rather than test-framework code so other implementations
can run the same malformed I-JSON, path traversal, unsafe URL, active-content,
and resource-limit cases. The reference runner imports only public SDK
entrypoints and fails closed on every rejected case.
