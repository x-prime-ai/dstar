# Viewer HTTP API

This is the authenticated API implemented by `@dstar/viewer`. It exists for
the Viewer UI and its WebMCP adapter; it is not a hosted DSTAR service and there
is currently no separate HTTP client package.

The API is pre-stable. Products building a custom backend should normally call
`@dstar/core` and define their own public HTTP contract.

`GET <basePath>/healthz` is the only credential-free operational endpoint. It
returns `{"status":"ready"}` without document metadata. All `/api` routes
below remain authenticated.

## Addressing model

One Viewer process opens one DSTAR package. An authenticated client bootstraps
with:

```http
GET /api/state
Authorization: Bearer <session-token>
```

The response includes `state.id`. Use that exact value as `docId` for every
document operation:

```text
/api/documents/:docId/...
```

An unknown or mismatched document ID returns `404`. There is no
`/api/webmcp/*` namespace.

## Request requirements

- Every API request requires the Viewer bearer credential.
- Every `POST` requires `Content-Type: application/json` and the exact configured
  `Origin`.
- A `GET` may omit `Origin`; if present, it must match exactly.
- Credentials belong in `Authorization`, never in query parameters, cookies,
  tool arguments or request bodies.
- Mutation bodies reject unknown fields.
- Responses use `Cache-Control: no-store`.

Examples below omit repeated headers.

## Bootstrap state

### `GET /api/state`

Returns the authenticated session projection and current document snapshot:

```json
{
  "session": {
    "role": "owner",
    "identity": {
      "id": "owner",
      "displayName": "Owner",
      "role": "owner"
    },
    "capabilities": [
      "read",
      "comment",
      "propose",
      "handoff",
      "reply",
      "decide",
      "resolve",
      "share",
      "request",
      "invoke"
    ]
  },
  "state": {
    "id": "11111111-1111-4111-8111-111111111111",
    "generation": 1,
    "head": "...",
    "proposals": [],
    "comments": [],
    "revisionRequests": []
  },
  "agentInvocationAvailable": false,
  "stateId": "sha256:...",
  "revision": "sha256:...",
  "title": "Document title",
  "resolutions": {}
}
```

The actual capability list is authoritative; do not infer permissions only from
the role label.

## Content and review routes

| Method | Route                                                | Purpose                                      |
| ------ | ---------------------------------------------------- | -------------------------------------------- |
| `GET`  | `/api/documents/:docId/revisions/:revision/files`    | Read exact immutable files                   |
| `POST` | `/api/documents/:docId/review-context`               | Validate and project current Viewer context  |
| `POST` | `/api/documents/:docId/proposals`                    | Submit a complete pending candidate          |
| `POST` | `/api/documents/:docId/revision-requests`            | Save an exact Owner revision request         |
| `POST` | `/api/documents/:docId/revision-requests/:id/invoke` | Run the optional trusted-host agent          |
| `POST` | `/api/documents/:docId/comments`                     | Add a comment                                |
| `POST` | `/api/documents/:docId/comments/:commentId/replies`  | Add an exact-state keyed reply               |
| `POST` | `/api/documents/:docId/comments/:commentId/resolve`  | Resolve a comment                            |
| `POST` | `/api/documents/:docId/proposals/:proposalId/accept` | Accept an exact proposal                     |
| `POST` | `/api/documents/:docId/proposals/:proposalId/reject` | Reject an exact proposal                     |
| `GET`  | `/api/documents/:docId/preview/:proposalId`          | Mint a short-lived preview capability        |
| `GET`  | `/api/documents/:docId/annotations/:proposalId`      | Resolve comment anchors for a viewed version |
| `GET`  | `/api/documents/:docId/diff/:proposalId?file=:path`  | Read one changed-file diff                   |

### Read revision files

```http
GET /api/documents/<docId>/revisions/sha256:<hash>/files
```

```json
{
  "revision": "sha256:...",
  "files": [
    {
      "path": "document.html",
      "encoding": "utf8",
      "content": "<!doctype html>..."
    }
  ]
}
```

Binary assets use `base64`.

### Create a proposal

```http
POST /api/documents/<docId>/proposals
```

```json
{
  "base": "sha256:...",
  "request": "Make the risks explicit",
  "key": "proposal-request-123",
  "commentIds": ["optional-comment-id"],
  "files": [
    {
      "path": "document.html",
      "encoding": "utf8",
      "content": "<!doctype html>..."
    }
  ]
}
```

`files` is a complete replacement set. The result is `{ "proposal": ... }`.
The call never accepts the proposal. A proposal returned for a durable request
also has `requestId`; the submitted `commentIds` must exactly match that
request's frozen IDs and are stored on the proposal as `motivatedBy`.

### Create a revision request

```http
POST /api/documents/<docId>/revision-requests
```

```json
{
  "base": "sha256:...",
  "instruction": "Address the selected feedback and keep the tone direct.",
  "commentIds": ["comment-id-1", "comment-id-2"],
  "key": "revision-request-123"
}
```

This Owner-only route requires the exact current accepted base and either a
nonblank instruction or at least one selected open comment. It returns `201`
with `{ "revisionRequest": ... }`. The public record contains `id`, `base`,
`instruction`, canonical `request` prose, sorted `commentIds`, immutable
`feedback`, `requester`, timestamps, `status`, `attempt`, optional `attemptId`,
optional `error`, and optional `proposalId`. Internal idempotency fields are not
projected.

Creation is durable before agent execution. Later replies or resolution change
the live comment thread but not the frozen feedback. Retry an uncertain create
with the same key and identical fields; changed input needs a new key.

### Invoke the configured host agent

```http
POST /api/documents/<docId>/revision-requests/<requestId>/invoke
```

```json
{ "attemptId": "88888888-8888-4888-8888-888888888888" }
```

This Owner-only route exists only when `startViewer` has a trusted-host
`agentInvocation` callback. A new attempt returns `202`; an identical active
retry returns the same running request, and invoking an already returned request
reconciles with `200` and its stored proposal. The callback runs asynchronously
with the frozen request and encoded base files. A valid complete candidate is
submitted through Core under the configured agent identity.

Timeout and invalid-candidate failures persist as `failed`; a changed accepted
base or closed selected comment persists as `conflicted`. `failed` and expired
external attempts may be retried with a new `attemptId`. A conflicted request
must be replaced by a new request against current state. Viewer/Core do not
promise exactly-once provider execution or prevent provider-side duplicate
charges.

### Add a comment

```http
POST /api/documents/<docId>/comments
```

```json
{
  "target": {
    "revision": "sha256:...",
    "element": "risk-summary",
    "selector": { "type": "element" }
  },
  "body": "Can we quantify this?"
}
```

The server derives the author from the authenticated session.

### Reply

```http
POST /api/documents/<docId>/comments/<commentId>/replies
```

```json
{
  "body": "Added the metric.",
  "key": "reply-request-456",
  "stateId": "sha256:..."
}
```

The result is `{ "comment": ... }`. Internal idempotency keys are not returned.
Retry an uncertain result with the same key and exact body; changed work needs a
new key.

### Decide a proposal

```http
POST /api/documents/<docId>/proposals/<proposalId>/accept
```

```json
{
  "revision": "sha256:...",
  "stateId": "sha256:..."
}
```

Use `/reject` for rejection. The expected revision and state ID must be the
values the authorized user actually reviewed.

### Resolve a comment

```http
POST /api/documents/<docId>/comments/<commentId>/resolve
```

```json
{ "stateId": "sha256:..." }
```

Resolution is separate from accepting a linked proposal.

Only the Owner can request/invoke revisions, propose document changes, decide
proposals or resolve comments. A Reviewer can read, comment, reply and create
comment-focused handoffs, but cannot use the revision-request or host-invocation
routes. The server derives every actor from the authenticated or scoped
principal.

## Review context

`POST /api/documents/:docId/review-context` accepts the top-level Viewer's
current proposal view, selection, action and focused comment. The server checks
that they all belong to the exact immutable revision before returning a public
context projection. This endpoint is mainly for the built-in WebMCP adapter;
custom clients usually use state, revision and comment routes directly.

## Preview capabilities

The preview endpoint returns a URL under `/frame/:capability/document.html`.
That URL grants temporary read access only to verified immutable preview bytes.
It is not a document API credential and cannot authorize mutations. Preview
HTML runs in a sandboxed opaque-origin iframe.

Do not log or publish preview URLs.

## Handoff resources

Short-lived agent handoffs are ephemeral authorization resources, not document
resources, so they remain under `/api/handoffs/...`:

```text
POST /api/handoffs
GET  /api/handoffs/:handoffId
POST /api/handoffs/:handoffId/draft
POST /api/handoffs/:handoffId/reply-draft
POST /api/handoffs/:handoffId/revoke
```

They are bound to an exact document state and review context, expire after 15
minutes, and disappear when Viewer restarts. An Owner can also create a batch
handoff for one durable revision request attempt. That handoff receives only
read/propose scope and must return a complete candidate using the request's exact
`base`, `request`, `commentIds`, `requestId` and prescribed key. Expiration or
revocation marks that attempt `expired` without deleting the durable request.
Accepted-head drift marks it `conflicted`. See [Viewer and WebMCP](viewer.md).

## Errors

Clients should handle at least:

- `401`: missing or expired Viewer authorization;
- `403`: capability, origin, authority or handoff-scope violation;
- `404`: unknown route, document or handoff resource;
- `409`: stale state/base, inactive or superseded request attempt, missing
  revision/comment, idempotency conflict or busy document;
- `413`: request exceeds the configured limit;
- `422`: candidate or operation validation failure.

Do not treat a network failure during a mutation as proof that nothing happened.
Retry keyed operations with identical arguments or refresh state before starting
new work.
