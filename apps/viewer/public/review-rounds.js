const REQUEST_STATUSES = new Set([
  "submitted",
  "running",
  "returned",
  "failed",
  "expired",
  "conflicted",
]);

export function revisionSelection(comments, selectedIds = []) {
  const open = new Set(
    (comments ?? [])
      .filter((comment) => comment?.status === "open")
      .map((comment) => comment.id),
  );
  return [...new Set(selectedIds)].filter((id) => open.has(id)).sort();
}

export function requestableRevisionComments(comments, anchors = {}) {
  return (comments ?? []).filter(
    (comment) =>
      comment?.status === "open" &&
      ["exact", "recovered"].includes(anchors?.[comment.id]?.status),
  );
}

export function revisionComposerState({
  comments,
  selectedIds,
  instruction,
  canCompose,
  submitting = false,
}) {
  const commentIds = revisionSelection(comments, selectedIds),
    cleanInstruction =
      typeof instruction === "string" ? instruction.trim() : "",
    empty = !commentIds.length && !cleanInstruction;
  return {
    commentIds,
    instruction: cleanInstruction,
    canSubmit: Boolean(canCompose) && !submitting && !empty,
    reason: !canCompose
      ? "Only the Owner can request a revision."
      : empty
        ? "Select at least one open comment or add an instruction."
        : submitting
          ? "Saving revision request…"
          : "",
  };
}

export function revisionRequestStatus(request) {
  const status = REQUEST_STATUSES.has(request?.status)
    ? request.status
    : "submitted";
  const error =
    {
      agent_invocation_timeout:
        "The host agent timed out. The saved request can be retried.",
      agent_invocation_failed:
        "The host agent did not return a valid candidate. The saved request can be retried.",
      agent_invocation_interrupted:
        "The Viewer restarted while the host agent was running. The saved request can be retried; provider-side work may still have occurred.",
      stale_base:
        "The accepted document changed. Prepare a new request against the current version.",
      comment_closed:
        "Selected feedback was resolved before the suggestion returned. Prepare a new request from current open comments.",
      external_handoff_expired:
        "The external handoff expired. The saved request can be retried.",
      external_handoff_interrupted:
        "The Viewer restarted, so the short-lived external handoff ended. The saved request can be retried.",
    }[request?.error] || request?.error;
  const copy = {
    submitted: {
      label: "Submitted",
      detail: request?.attempt
        ? "An external handoff was issued; the request remains saved while awaiting a result."
        : "Saved and ready to send to an agent.",
    },
    running: {
      label: "Running",
      detail: "The host reports that this request is running.",
    },
    returned: {
      label: "Returned",
      detail: "A linked suggestion is ready to review.",
    },
    failed: {
      label: "Failed",
      detail: error || "The latest invocation failed.",
    },
    expired: {
      label: "Expired",
      detail:
        "The latest external handoff expired; the request is still saved.",
    },
    conflicted: {
      label: "Needs a new request",
      detail:
        error ||
        "The accepted document changed, so this request cannot return a current suggestion.",
    },
  }[status];
  return {
    status,
    ...copy,
    canInvoke:
      (status === "submitted" && (request?.attempt ?? 0) === 0) ||
      ["failed", "expired"].includes(status),
  };
}

const actorKey = (actor) =>
  typeof actor === "string"
    ? actor
    : JSON.stringify({
        id: actor?.id ?? null,
        displayName: actor?.displayName ?? null,
        role: actor?.role ?? null,
      });

const replyKey = (reply) =>
  JSON.stringify({
    id: reply?.id ?? null,
    body: reply?.body ?? "",
    author: actorKey(reply?.author),
    createdAt: reply?.createdAt ?? null,
  });

export function feedbackDrift(snapshot, current) {
  if (!current)
    return {
      changed: true,
      kind: "missing",
      message:
        "This comment is no longer in the current review state; the submitted snapshot is preserved.",
    };
  const resolved = snapshot?.status === "open" && current.status !== "open";
  const snapshotReplies = (snapshot?.replies ?? []).map(replyKey),
    currentReplies = (current.replies ?? []).map(replyKey),
    discussionChanged =
      snapshot?.body !== current.body ||
      snapshotReplies.length !== currentReplies.length ||
      snapshotReplies.some((reply, index) => reply !== currentReplies[index]);
  if (resolved)
    return {
      changed: true,
      kind: discussionChanged ? "resolved-and-discussed" : "resolved",
      message: discussionChanged
        ? "Resolved after submission, with newer discussion. The agent request keeps the earlier snapshot."
        : "Resolved after submission. The agent request keeps the open-comment snapshot.",
    };
  if (discussionChanged)
    return {
      changed: true,
      kind: "discussion",
      message:
        "Newer discussion exists. The agent request keeps the feedback as submitted.",
    };
  if (snapshot?.status !== current.status)
    return {
      changed: true,
      kind: "status",
      message:
        "The comment status changed after submission; the submitted snapshot is preserved.",
    };
  return { changed: false, kind: "same", message: "" };
}

export function proposalChangeDestination(proposal, comment) {
  const files = proposal?.diff?.files ?? [],
    element = comment?.target?.element,
    anchorStatus =
      (proposal?.diff?.anchorRisks ?? []).find(
        (risk) => risk?.comment === comment?.id,
      )?.status ?? "exact",
    mapped =
      typeof element === "string" &&
      (proposal?.diff?.elements ?? []).some((change) => change?.id === element),
    documentFile = files.find((file) => file.path === "document.html"),
    stylesheet = files.find((file) => file.path.endsWith(".css")),
    asset = files.find((file) => file.path.startsWith("assets/")),
    firstFile = files[0] ?? null;
  if (mapped && documentFile)
    return {
      mapped: true,
      kind: "target-element",
      path: documentFile.path,
      element,
      anchorStatus,
      message:
        anchorStatus === "exact"
          ? `The comment's target element (${element}) changed. It will be shown first; this link does not prove the feedback was satisfied.`
          : `The comment's target element (${element}) changed, but its text anchor is ${anchorStatus} in After. Inspect both sides; this link does not prove the feedback was satisfied.`,
    };
  if (["ambiguous", "orphaned"].includes(anchorStatus))
    return {
      mapped: false,
      kind: "unlocated-anchor",
      path:
        documentFile?.path ??
        stylesheet?.path ??
        asset?.path ??
        firstFile?.path ??
        null,
      element: null,
      anchorStatus,
      message: `The comment anchor is ${anchorStatus} in After, and no exact changed element can be established. The selected file is only a review starting point.`,
    };
  if (stylesheet)
    return {
      mapped: false,
      kind: "css-layout",
      path: stylesheet.path,
      element: null,
      anchorStatus,
      message:
        "No local HTML element change matches this comment. Opening the stylesheet because CSS can change layout or appearance; DSTAR cannot prove which rendered element it affected.",
    };
  if (asset)
    return {
      mapped: false,
      kind: "asset",
      path: asset.path,
      element: null,
      anchorStatus,
      message:
        "No local HTML element change matches this comment. Opening a changed asset as a review starting point; compare Before and After for its rendered effect.",
    };
  return {
    mapped: false,
    kind: "file-fallback",
    path: documentFile?.path ?? firstFile?.path ?? null,
    element: null,
    anchorStatus,
    message:
      "No exact changed element can be established for this comment. Review the selected file and the full Before / After versions; the link does not prove the feedback was satisfied.",
  };
}
