# HTML-first integration validation

This record covers the HTML-first Engine and Viewer on the integration branch,
not the retained JSON/MCP implementation. No deployment, public service, demo,
or browser setting change is part of this validation.

## Baseline and independent fix

Baseline: `6902987`. The complete `pnpm verify` passed under Node 22.22.3 and
pnpm 10.28.2 with permission for loopback HTTP tests. The initial sandbox run
stopped at `listen EPERM`; that was an environment restriction, not a skipped
test. The permitted run passed.

`f9296e0` checks the parsed HTML tree limits before recursive descendant text
indexing. A 5,000-level stable-ancestor fixture previously raised a stack
overflow; it now raises the intended HTML resource-limit error. Existing
Engine regression tests, type checking and formatting passed (29 tests at
this point).

## Verification method

Automated tests use temporary document directories, actual Engine persistence,
HTTP servers and process restarts. The configured-origin checks send an
explicit Host and Origin to a loopback listener, modeling a trusted TLS
terminator; they do not establish a real TLS connection.

Browser checks use the Browser skill against an isolated, locally generated
fixture. Page tools must be discovered and called through the host's WebMCP
capability. No API is injected for those checks. Unit tests with a modelContext
test double are contract tests only. A read-only browser evaluation returning
`typeof document.modelContext === "undefined"` is not proof of API absence in
the page's main environment.

### Existing-comment agent closure (2026-08-29)

The comment-addressing work starts from `main` commit `0910f8a` in an
independent worktree. It does not merge the separate Engine record-storage
work, change main, deploy a service or create a demo. Its regression scope is:

- create an exact `address-comment` handoff from an existing open comment and
  restore `focusedComment` in a separate browser task without the source tab;
- return a reply draft to an editable human composer without creating a reply;
- create a pending proposal with validated `commentIds`, project the persisted
  `motivatedBy` relation, and show “Addresses comment …” in proposal history;
- reject wrong-comment, stale-state, changed-page, expired and over-broad
  handoff operations; and
- prove proposal decisions do not resolve comments and agent scope contains no
  accept, reject or resolve mutation.

The focused Engine suite passed 35 tests and the Viewer suite passed 127 tests,
including real loopback HTTP, process restart, handoff scope and WebMCP adapter
coverage. A Codex In-app Browser check against a temporary local package found
all seven page tools, exercised the visible **Ask agent to address** action,
created a linked pending proposal through actual page WebMCP, displayed both
directions of the comment/proposal relationship, explicitly accepted it, and
confirmed the comment remained open. The reply composer retained editable text
without posting and discarded it on Cancel. Browser warning/error logs were
empty. The fixture was removed after the check.

The complete `pnpm verify` then passed under Node 22.22.3 and pnpm 10.28.2:
format, lint, boundaries, schemas/spec/links, build, conformance, security,
portable reopen, release packaging, type checking, every workspace test and the
consumer build. Loopback permission was granted for the real Viewer HTTP tests.

## Regression procedure

1. Preview a pending genesis and verify that accepted head remains empty.
   Accept explicitly through the confirmation dialog and inspect history.
2. Select Unicode text or an element in the sandbox, add a comment, discover
   all four page tools and read the exact displayed revision and file set.
3. Propose a complete changed file set through the page tool; verify accepted
   head, current preview, selection and draft remain unchanged. Retry the same
   key and ensure the original proposal is returned.
4. Review candidate and base, reply to a comment with an idempotent key,
   accept one proposal and reject another; inspect original comment targets
   and accepted history. Verify a stale base cannot be accepted or proposed.
5. Exercise invalid HTML/CSS, path/resource/request limits, unauthorized and
   cross-origin calls. Confirm there are no human-decision tools and no
   credentials in tool results.
6. Repeat tool HTTP routes under a configured external origin. Restart the
   persistent Node entrypoint and verify document revision, comments and
   decisions survive while process-local preview capabilities expire.
7. From an existing comment, exercise both handoff outcomes: return an editable
   reply draft, then create an exact linked proposal. Verify wrong links and
   direct agent reply/decision routes fail, accept the linked proposal as a
   person, and confirm the comment remains open.

## Integration results

Checked on 2026-08-28 in `codex/dstar-integrated-review`, without merging main.

| Source commit | Integration commit | Work                                                                             |
| ------------- | ------------------ | -------------------------------------------------------------------------------- |
| `6902987`     | baseline           | HTML-first Engine/Viewer                                                         |
| `f9296e0`     | same               | Early HTML tree resource guard and regression                                    |
| `8220958`     | `df002a8`          | WebMCP, restricted agent routes, review context and idempotent replies           |
| `bdbc1b0`     | `898a0f5`          | Explicit runtime configuration, persistent entrypoint and deployment preparation |

Integration resolved README, server and server-test conflicts while preserving
both suites. Agent dispatch is after trusted request authority, Bearer and
existing-Origin checks; its own exact POST Origin/content-type validation is
also retained. Neither the legacy server nor main was changed.

The integration follow-up also:

- Extends the existing server suite with a configured HTTPS-origin/Host test
  for all four agent routes. It reads a Unicode selection and exact document,
  submits a candidate larger than the ordinary 64 KiB API limit, verifies head
  is unchanged, rejects bad authority/credentials on every route, and checks
  persisted proposal/reply retries after restart. Old preview capabilities
  expire; comment targets, open status and exact file bytes survive.
- Raises Compose's temporary filesystem from 16 to 64 MiB, allowing the
  agent's permitted 32 MiB decoded staging set. Adds the proxy's explicit
  48 MiB request cap so Nginx's smaller default does not reject allowed
  candidates before the agent route. These are reviewed configuration fixes,
  not claims of a running container or tested production capacity.

### Automated checks actually run on the integrated tree

`pnpm verify` passed: Node check, format, lint, dependency boundaries, schema
drift, spec fixtures, local Markdown links, build, conformance, security
corpus, portable reopen, release packaging, type checking, all tests and the
consumer build. Total: 198 tests, including **30 Engine** and **76 Viewer**
tests. The remaining tests cover the retained legacy workspace as regression
protection, not as the new implementation.

`docker compose ... config --quiet` and `git diff --check` passed. Compose was
only parsed; no container or public service was started.

### Actual Browser / WebMCP host checks

The Codex In-app Browser displayed “WebMCP connected · 4 tools”. Browser tool
discovery returned only `get_review_context`, `read_document`,
`propose_revision`, and `reply_comment`. Calls went through the actual page,
HTTP server and filesystem Engine, with no injected modelContext API:

- Actual text selection after an emoji returned code-point offsets `30..31`
  for the final period, rather than UTF-16 offsets; Alt-click selected the
  stable element. Context matched the displayed revision, original comment
  target and complete immutable document read.
- Full-file proposal submission created a pending revision without moving
  accepted head. The iframe URL, selected target and unsubmitted comment
  draft survived the proposal, reply and explicit Refresh. Retrying proposal
  and reply keys returned the same proposal and a single reply.
- Base comparison returned the base selection revision and disabled Accept.
  Returning to the candidate and confirming acceptance produced two accepted
  history entries, with the comment still open. A new stale-base request and
  unsafe remote CSS were rejected; the original accepted-proposal retry still
  returned its original ID.
- A PNG signature-only file passed the intentionally basic Engine signature
  check but failed the actual browser decoder. The trusted preview reported
  `failed` and disabled Accept. Explicit rejection recorded the rejected
  proposal without changing accepted head.
- Page reload re-registered callable tools and retained two accepted versions,
  one rejected proposal, the original comment and its one agent reply. Browser
  error/warning logs were empty at the end of these interactions. Tool results
  were checked against the local fixture credential; no credential appeared.

The local fixture was created solely for verification; this is not a demo.

### Still unverified

- Independent Chrome native WebMCP implementation. Successful Codex host
  discovery/calls do not establish Chrome version, origin-trial or native
  conformance. Mock registration tests remain separately identified as unit
  contract tests. No browser flags or extensions were installed/changed.
- A real Docker image build/run, Linux volume/secret ownership and a live
  Nginx/TLS/browser path. The runtime task reported an unavailable Docker
  daemon even with permission; its production-dependency packaging and Node
  restart checks are not a substitute for these checks.
- Production load, hostile multi-tenant isolation or cryptographic human
  identity. The instance remains one protected document with shared session
  authority; tools intentionally have no accept/reject/resolve capability.
