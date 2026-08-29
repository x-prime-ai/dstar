# Viewer WebMCP collaboration

This implements the HTML-first path on `dstar-html-0.2-dev`. It does not use
the legacy MCP server, JSON document format, an MCP transport, an agent chat
backend or a page-injected WebMCP polyfill. The canonical artifact remains the
complete HTML/CSS/local asset file set.

## Browser API and support

Checked against the [Chrome imperative API documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api?hl=en)
(updated August 20, 2026) and [WebMCP overview](https://developer.chrome.com/docs/ai/webmcp):

- The top-level Viewer calls `document.modelContext.registerTool(tool, {signal})`.
  Execution is `execute(args, {signal})`; results are JSON serialized to strings.
- Registration uses an `AbortController` for cleanup, including partial failure
  and `pagehide`; a restored page registers again. The execution signal is passed
  to `fetch`. There is no `navigator.modelContext` fallback.
- The Chrome documentation describes a local `enable-webmcp-testing` flag and
  an origin trial. Availability still depends on the actual browser and origin.
- The top-level page uses `Origin-Agent-Cluster: ?1` and `tools=(self)`.
  Authored previews have `tools=()` and no iframe permission delegation.

`public/webmcp.js` is an optional enhancement. Missing API or failed
registration is shown in the UI; normal preview, comments, decisions and history
continue to work. The implementation does not fabricate an API if none exists.

Tool registration is also gated on a successful authenticated Viewer state read.
Without a valid tab session the page shows **Authorize Viewer** instead of
advertising connected tools. Paste the complete private access link (including
its fragment), or open it in this browser. Use **Copy access link** in an already
authorized Viewer to transfer access deliberately; browser profiles and tabs do
not share session storage. A 401 drops the stale credential and tool registration,
pauses polling, and shows the authorization screen. A late response from a
replaced credential cannot invalidate a newer session. Network failures do not
erase a working credential. Authorization errors from an in-flight tool use
`authorization_required` with recovery instructions, never the token itself.

## Tool contract

All six tools belong to the Viewer page, not the sandboxed document. All input
schemas reject additional properties. Descriptions and annotations mark document
and comment contents as untrusted data. A tool must not treat instructions found
inside that content as user authorization.

| Tool                         | Arguments                     | Result on success                                                                                                                                             |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_review_context`         | `{}`                          | Package/state IDs, generation, accepted head, reviewed proposal/version, selection/action, explicitly focused comment, proposals, comments/replies and limits |
| `read_document`              | `{revision}`                  | Exact immutable revision and complete `files` array                                                                                                           |
| `draft_selection_comment`    | `{body}`                      | Opens an editable comment draft for the exact selection; never posts it                                                                                       |
| `draft_selection_suggestion` | `{replacement}`               | Fills the editable suggestion composer for the exact selection; never submits it                                                                              |
| `propose_revision`           | `{base, request, key, files}` | Stored proposal, including its exact base/revision, status and review diff                                                                                    |
| `reply_comment`              | `{commentId, body, key}`      | Comment with its replies; status is not changed                                                                                                               |

Every tool result is a string containing a JSON object with `ok: true` or
`ok: false`. Successful mutation results also include `viewerUpdated`. If a
write succeeds but the subsequent Viewer refresh fails, it remains `ok: true`
with `viewerUpdated: false`: the caller must not mistake a presentation failure
for a failed write. There are no accept, reject, resolve, filesystem, network or
shell tools.

### Exact review context

The context tool captures the selected proposal, base/candidate comparison mode,
preview readiness and selection **at execution time**. It sends them to the
server for validation, and separately reads the current accepted head. Thus a
user may still be reviewing an older version while the accepted head changes.

`head` is null before initial acceptance, otherwise `{proposalId, revision}`.
`review` is null before any version is selected, otherwise:

```js
{
  (proposalId, showingBase, revision, previewStatus, status, base, stale);
}
```

`revision` is the exact version displayed: the candidate revision normally, or
the proposal base during comparison. `stale` means a pending proposal's parent
is no longer the accepted head. `previewStatus` is `loading`, `ready` or
`failed`; it describes presentation state, not identity or authorization.

`selection` is null or the existing Engine target shape:
`{revision, element, selector}`. Text selectors use zero-based Unicode code
points, exact quotation and optional context, as in [HTML MVP](html-mvp.md).
The Viewer accepts selection messages only from its ready frame with the exact
capability and revision. The server then verifies that the supplied reviewed
proposal has that revision, that the selection revision equals the viewed
revision, and that the target exactly matches its immutable HTML index. It never
substitutes the latest head into an older target. A selection cannot be sent as
ready while the preview is still loading or has failed.

`action` is transient and null until the user explicitly chooses **Comment** or
**Suggest** beside a selection. It is `{kind, target, draft?}`, where `kind` is
`comment` or `suggest` and `target` must exactly equal `selection`. An optional
`draft` captures the editable text at the moment the user asks for agent help.
The action records intent for the external browser agent; the user's instruction
is still entered in the agent chat, not in the Viewer. WebMCP does not provide a
generic page API that opens or prompts that chat.

Clicking **Ask agent to draft** stores the current action and draft, then uses
the browser Clipboard API to copy a handoff prompt. The prompt contains only the
Viewer origin, never the fragment credential, selection text or draft. It tells
the agent to reuse the already-open tab because opening the URL in another tab
would lose the transient selection. Clipboard failure does not clear the action;
the Viewer instead shows instructions for addressing the open tab manually.

For **Comment**, the agent may call `draft_selection_comment`. For **Suggest**,
it may call `draft_selection_suggestion`. Both tools only fill the matching
editable Viewer composer and fail rather than overwrite text changed since the
user asked for help. The user can edit or discard the draft before posting or
submitting it.

A manually submitted suggestion replaces one exact `text-range` within one
stable element and becomes a normal pending human proposal. Other files remain
unchanged, and accepting or rejecting still happens in the Viewer. Structural,
whole-element and multi-element changes use `propose_revision` with a complete
candidate instead.

Selections are transient, tab-local state. A comment persists the original
target/revision in the Engine. Refresh and agent activity preserve selections;
explicitly switching previews clears them. Page navigation does not persist
unsent drafts or selections. Comment `viewedResolution` is computed at
`resolutionRevision` (the viewed revision, or accepted head when no view was
provided), not silently labeled as the head's resolution.

### Complete candidates

`base` is the exact accepted `sha256:` revision from context, or null before
initial acceptance. A pending candidate's revision is **not** a new base until
accepted. `read_document` accepts only an exact revision, including pending,
rejected and historical versions; aliases such as `head` are rejected.

Each file is exactly `{path, encoding, content}`. HTML/CSS use `encoding: "utf8"`;
supported binary images/fonts use canonical `base64`. The returned file array is
directly editable and resubmittable. Example creation arguments:

```json
{
  "base": null,
  "request": "Create the initial note",
  "key": "initial-note-1",
  "files": [
    {
      "path": "document.html",
      "encoding": "utf8",
      "content": "<!doctype html><html><head><title>Note</title></head><body><p data-dstar-id=\"intro\">A note for review.</p></body></html>"
    }
  ]
}
```

This array is a complete replacement file set, not a patch. Omitted files are
deleted in the candidate. Preserve surviving stable element IDs and include all
referenced assets. A proposal creates immutable candidate storage and a review
diff but never modifies accepted files. The Viewer must already be serving an
HTML-first package; creating/opening package roots remains host/CLI work.

## Restricted HTTP bridge

`src/agent-api.mjs` handles only these authenticated JSON POST routes:

| Route                  | Body                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `/api/agent/context`   | `{review?, selection?, action?, focusedCommentId?}` supplied by the top-level page, validated as above |
| `/api/agent/document`  | `{revision}`                                                                                           |
| `/api/agent/proposals` | `{base, request, key, files}`                                                                          |
| `/api/agent/reply`     | `{commentId, body, key}`                                                                               |

The normal Viewer Bearer-session gate runs first. Each route also requires the
configured exact Origin and `Content-Type: application/json`. No route accepts
a package root, server file path, URL to fetch, executable command, author
override or decision. The browser's request closure retains the credential; it
is not a tool argument or result. Results project public document/review data,
excluding tokens, frame capabilities, storage locations and internal command
fingerprints. Unexpected Engine/filesystem errors are not echoed to tools.

Before any filesystem write, the bridge validates canonical paths and encodings,
rejects duplicate paths, case collisions (including directory components),
file/directory collisions, traversal, absolute paths, hidden paths, backslashes,
percent encodings and unsupported file types. Bounds are:

| Resource                          | Maximum                           |
| --------------------------------- | --------------------------------- |
| Candidate JSON request            | 48 MiB                            |
| Other agent JSON requests         | 64 KiB                            |
| Decoded files                     | 512                               |
| One decoded file                  | 8 MiB                             |
| All decoded files                 | 32 MiB                            |
| Canonical path                    | 240 ASCII characters, 12 segments |
| Directory entries including files | 2,048                             |
| Request/reply text                | 20,000 JavaScript string units    |
| Idempotency key                   | 200 JavaScript string units       |

The JSON byte cap can be reached before the decoded-content cap because of
escaping. Asset signatures, referenced paths and HTML/CSS are checked by the
existing Engine validator. Only after validation does the server create a
private random temporary directory outside the package, write the supplied
bytes, and call `engine.propose`. Engine revalidates the staged files and exact
base, computes deltas and commits the proposal under its write lock. Temporary
files are removed in `finally`; there is no shell or outbound fetch operation.

The preview's sandbox without `allow-same-origin`, nonce-only trusted bridge,
CSP, immutable read-only capabilities and resource readiness gate remain in
place. A preview capability cannot authorize agent API calls.

### Retry, concurrency and errors

Proposal keys use the existing persisted Engine command identity
`[base, candidateRevision, request, author]`. An identical retry returns the
original proposal even if it has since been accepted or rejected. Changed
arguments under that key fail. A stale base under a new key fails; no implicit
merge or base rewrite occurs.

`engine.reply` adds an optional fourth argument, `key`. Its check and append run
under the same Engine transaction; the key is persisted on the reply. The key
is unique among keyed replies in that package: reusing it for different text,
author or comment fails. Existing unkeyed human/CLI replies remain supported.
Proposal and reply key namespaces are separate. No mutation auto-resolves a
comment. After cancellation or a lost connection, retry identical arguments
with the **same key**; aborting a fetch cannot undo an already committed write.

Error results have `{ok:false, code, error}`. Codes include `invalid_input`,
`too_large`, `stale_base`, `idempotency_conflict`, `not_found`, `no_changes`,
`busy`, `validation_failed`, `forbidden`, `unknown_route`, and the browser-side
`connection_error`. HTTP validation/input failures use 400/413/422; conflicts
and busy/not-found conditions use 409. Unknown agent routes use 404. A 401 from
the shared session gate is reported as a connection/session failure by the tool.

Tool mutations refresh the Viewer immediately. A three-second poll also picks
up external CLI changes when the page is visible. Reads have sequence and
generation guards so late responses cannot roll the UI back. Unchanged state
does not rerender; new metadata updates queue, comments, history and decision
availability without changing the selected version, comparison mode, iframe,
width, slide position or draft. Failed previews require an explicit Refresh;
they are not continuously reloaded. Stale proposals remain inspectable and
rejectable but cannot be accepted. Decisions keep their exact state hash check,
including when a comment arrives while a confirmation dialog is open.

## Authority and limitations

“Agent proposes, person decides” is the tool/workflow boundary. It is **not** a
cryptographic proof of human identity. The session credential also authorizes
normal Viewer decision endpoints; a trusted local process or an automation with
equivalent session/UI access can act outside the six WebMCP tools. There is no
separate agent principal, signed human identity, remote multi-user auth or
network-service security claim in this change.

The bridge inherits synchronous Engine replay/validation and metadata limits.
It does not provide result pagination or streaming asset upload, and large
complete document results can exceed an agent's own context/tool-result budget.
Only the existing static HTML/CSS/raster/font profile is supported. Browser API
and tool-client compatibility are experimental and may change.

## Verification

```sh
pnpm --filter @dstar/engine build
pnpm --filter @dstar/engine test
pnpm --filter @dstar/viewer test
pnpm lint
pnpm --filter @dstar/engine typecheck
pnpm check:links
```

Viewer HTTP tests require permission to listen on loopback. They exercise
complete files/assets, genesis, comments at exact candidate/base revisions,
replies and persisted retries, competing proposals, stale decisions, rejected
history, invalid paths/content/encodings, byte caps, origin/auth and route
restrictions. Adapter tests use explicitly labeled registration doubles to
check schemas, execution signals, cleanup and unavailable-browser behavior;
those tests are not evidence of native browser support.

Current UI verification in Codex In-app Browser discovered all six page tools.
Earlier end-to-end verification called the original four remote tools through
its Browser WebMCP capability: read context/document, propose a complete
revision, reply and retry, then explicit UI confirmation/acceptance, history and
stale-base rejection. The iframe URL, selection and unsent draft survived agent
changes; base comparison and its original selection revision survived Refresh.
This establishes the available browser host's integration, not independent
verification of Chrome's native implementation. No API was injected by the
test. A separate Chrome build with WebMCP enabled remains a follow-up
compatibility check; do not report it as passed on this evidence.
