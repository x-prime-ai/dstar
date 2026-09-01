# Development window evidence

The WebMCP Challenge submission period began on **August 25, 2026 at 11:00 AM
PDT**. DSTAR therefore qualifies as a pre-existing project that was meaningfully
extended with WebMCP during the submission period, rather than as a project
created entirely after the start time.

## Before the submission period

The repository contained three design-only commits before the cutoff:

| Commit    | Time (PDT)       | Scope                                   |
| --------- | ---------------- | --------------------------------------- |
| `1ef4a1b` | Aug 24, 9:51 PM  | Initial vision and 0.1 pre-draft spec   |
| `0d694d8` | Aug 24, 11:18 PM | Reviewable projection selection design  |
| `e5990eb` | Aug 25, 1:29 AM  | Agent-authored document workflow design |

These commits established the concept and early protocol notes. They did not
contain the submitted HTML-first Viewer WebMCP implementation.

## Meaningful work during the submission period

Representative dated commits include:

| Commit    | Time (PDT)       | New work                                                              |
| --------- | ---------------- | --------------------------------------------------------------------- |
| `1579a17` | Aug 26, 2:57 AM  | SDK workspace implementation                                          |
| `6902987` | Aug 27, 11:30 PM | HTML-first documents, Engine and versioned review                     |
| `df002a8` | Aug 27, 11:59 PM | Viewer WebMCP registration, exact context and restricted agent bridge |
| `b6d7152` | Aug 28, 12:07 AM | Integrated WebMCP/runtime validation and deployment boundary fixes    |
| `1500251` | Aug 29, 12:05 AM | Short-lived external-agent handoffs across browser sessions           |
| `8ed3275` | Aug 29, 1:30 AM  | Owner/Reviewer roles and trusted identities                           |
| `0e6f216` | Aug 29, 1:32 AM  | Comment-to-agent reply/proposal loop                                  |
| `83de09b` | Aug 29, 1:33 AM  | Viewer information architecture redesign                              |
| `15bf0c3` | Aug 29, 1:39 AM  | Isolated resettable online workspace service                          |
| `573144f` | Aug 29, 2:22 AM  | Browser-discovered review fixes and end-to-end regression closure     |
| `1374491` | Aug 30, 11:31 PM | Four HTML-first sample document formats                               |
| `6088850` | Aug 31, 12:18 AM | Document creation through an external WebMCP agent                    |
| `7f136e8` | Aug 31, 10:46 PM | Reusable Viewer slide navigation shell and keyboard control           |

Later integration commits on `main` preserve the original author and commit
timestamps. The public repository should expose this history without rewriting
the cutoff evidence.

## Submitted WebMCP surface

The submitted WebMCP implementation lives primarily in:

- `apps/viewer/public/webmcp.js`
- `apps/viewer/src/agent-api.mjs`
- `apps/viewer/src/server.mjs`
- `apps/viewer/public/app.js`
- `design/webmcp.md`

The browser-facing tools and the restricted authenticated bridge were first
introduced by `df002a8` after the submission period began and were extended by
the later role, handoff, comment and workspace commits listed above.
