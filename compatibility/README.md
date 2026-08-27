# MCP host compatibility

Status date: 2026-08-26. “Passed” means the named command or automated test ran
against the listed version; documentation-only support is not treated as a
pass.

| Host                                            | Version/evidence                                             | Tools                                                                   | Resources                                             | Subscriptions                                                           | MCP App                 | Fallback                          |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------- | --------------------------------- |
| xPrime                                          | local `91c49d5`; `XPRIME_ROOT=… pnpm check:xprime`           | Passed: fixed document → xPrime MCP client → pending proposal → separate human acceptance | Not exercised: current host does not expose Resources | Not implemented by host                                                 | Not implemented by host | Ten tool-complete operations   |
| Official MCP TypeScript client conformance host | `@modelcontextprotocol/client` 2.0.0, linked transport tests | Passed                                                                  | Passed: templates/list/read and fixed document scope  | Advertised; end-to-end notification delivery not re-verified            | Not a UI host           | Tools remain independently usable |

The DSTAR server exposes no `ui://` resource and no
`io.modelcontextprotocol/ui` extension metadata yet. This is an explicit
capability result, not silent partial App behavior: hosts discover tools and
Resources only, and hosts without Resources use tools only.

## App packaging gate

xPrime currently documents that it does not negotiate MCP Apps, load `ui://`
resources, or run App iframes. Its roadmap still lists the sandbox/bridge work
as incomplete. DSTAR will not claim xPrime App compatibility until that host
surface has a released, testable contract.

There is also an authority decision that implementation cannot infer: the
standalone review UI permits a human to accept or reject proposals, while the
current DSTAR constraint says no MCP path may accept canonical content. An MCP
App runs through an MCP host. Packaging the complete review surface therefore
requires an explicit decision between:

1. a read/comment/propose-only App with proposal decisions remaining in the
   standalone loopback UI; or
2. a narrowly human-gated App decision channel, which would amend the current
   blanket “no MCP path accepts canonical content” rule and require protocol,
   fixture, sandbox, and host-attestation work.

Until that decision and compatible xPrime support exist, tool-only behavior is
the normative fallback and the existing authority boundary remains intact.
