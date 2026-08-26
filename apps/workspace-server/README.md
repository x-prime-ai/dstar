# DSTAR workspace server

Private loopback-only review API and static application host. Every package read
and mutation is mediated by an immutable snapshot and `@dstar/node`; browser
requests use bearer authentication, a separate CSRF token, and strict origin
checks.
