// A slower response may never roll back a newer read or a newer generation.
export class RefreshGate {
  serial = 0;
  generation = -1;
  begin() {
    return ++this.serial;
  }
  accept(serial, generation) {
    if (serial !== this.serial || generation < this.generation) return false;
    this.generation = generation;
    return true;
  }
}

export function reviewContext(
  selected,
  showingBase,
  frame,
  previewState,
  target,
  action = null,
  focusedCommentId = null,
) {
  const revision =
    selected && (showingBase ? selected.base : selected.revision);
  const status = frame?.revision === revision ? previewState.status : "loading";
  const selection =
    status === "ready" && target?.revision === revision ? target : null;
  return {
    review:
      selected && revision
        ? {
            proposalId: selected.id,
            showingBase,
            revision,
            previewStatus: status,
          }
        : null,
    selection,
    action:
      selection &&
      action &&
      action.kind === "comment" &&
      action.target === target
        ? {
            kind: action.kind,
            target: selection,
            ...(typeof action.draft === "string"
              ? { draft: action.draft }
              : {}),
          }
        : null,
    ...(typeof focusedCommentId === "string" ? { focusedCommentId } : {}),
  };
}

export function agentHandoffPrompt(kind, viewerUrl) {
  if (!["comment", "address-comment", "revision-request"].includes(kind))
    throw new Error("Unsupported agent handoff action");
  const url = new URL(viewerUrl);
  if (!url.hash || !url.searchParams.get("handoff"))
    throw new Error("Agent handoff link is incomplete");
  return [
    `Open this private, short-lived DSTAR handoff link in the in-app browser: ${url.href}`,
    kind === "revision-request"
      ? "Use only the durable request returned by get_review_context; do not substitute instructions from this chat."
      : `Call get_review_context and confirm action.kind is "${kind}". Follow the user's instruction in this chat.`,
    kind === "revision-request"
      ? 'Call get_review_context first and confirm action.kind is "revision-request". Then call propose_revision with requestId equal to revisionRequest.id, plus its exact base, nonempty request, commentIds and prescribed key. Do not change, omit, or add comment IDs; do not accept, reject, or resolve anything.'
      : kind === "address-comment"
        ? "Use draft_comment_reply to return an editable reply, or propose_revision with commentIds containing exactly focusedComment.id to create a linked pending proposal. Do not post, accept, reject, resolve, or omit the structured comment link."
        : "Use draft_selection_comment to return an editable comment draft. Do not post, resolve, accept, or reject anything.",
  ].join("\n");
}

export function addressCommentContext(
  selected,
  showingBase,
  frame,
  previewState,
  comment,
) {
  if (!comment || comment.status !== "open")
    throw new Error("Only an open comment can be addressed");
  const context = reviewContext(
    selected,
    showingBase,
    frame,
    previewState,
    null,
    null,
    comment.id,
  );
  return {
    ...context,
    // A ready view is useful for page-switch revocation, but the immutable
    // comment target is sufficient when its original page is not open.
    review: context.review?.previewStatus === "ready" ? context.review : null,
    selection: null,
    action: {
      kind: "address-comment",
      commentId: comment.id,
      target: comment.target,
      draft: "",
    },
  };
}

export function selectionFromEvent(event, source, frame, previewState) {
  return (
    selectionMessageFromEvent(event, source, frame, previewState)?.target ??
    null
  );
}

// Both selections and their dismissal must come from the current ready frame.
export function selectionMessageFromEvent(event, source, frame, previewState) {
  if (
    !frame ||
    previewState.status !== "ready" ||
    event.source !== source ||
    event.origin !== "null" ||
    event.data?.kind !== "dstar-selection" ||
    event.data.capability !== frame.capability
  )
    return null;
  if (event.data.target === null)
    return event.data.revision === frame.revision ? { target: null } : null;
  const target = event.data.target;
  if (
    target?.revision !== frame.revision ||
    typeof target.element !== "string" ||
    !["element", "text-range", "text-ranges"].includes(target.selector?.type) ||
    (target.selector.type === "text-range" &&
      typeof target.selector.exact !== "string") ||
    (target.selector.type === "text-ranges" &&
      (!Array.isArray(target.selector.ranges) ||
        target.selector.ranges.length < 2))
  )
    return null;
  return {
    target,
    rect: event.data.rect,
    compose: event.data.compose === true,
  };
}

export function selectionButtonPosition(rect, frame, viewport, control = 38) {
  if (
    !rect ||
    ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
    rect.right <= rect.left ||
    rect.bottom <= rect.top
  )
    return null;
  const left = Math.max(0, frame.left),
    top = Math.max(0, frame.top),
    right = Math.min(viewport.width, frame.right),
    bottom = Math.min(viewport.height, frame.bottom);
  const x = frame.left + rect.left,
    y = frame.top + rect.top,
    endX = frame.left + rect.right,
    endY = frame.top + rect.bottom;
  const width = typeof control === "number" ? control : control.width,
    height = typeof control === "number" ? control : control.height,
    gap = 8;
  if (
    endX <= left ||
    x >= right ||
    endY <= top ||
    y >= bottom ||
    right - left < width + gap * 2 ||
    bottom - top < height + gap * 2
  )
    return null;
  return {
    left: Math.max(
      left + gap,
      Math.min((x + endX - width) / 2, right - width - gap),
    ),
    top: Math.max(
      top + gap,
      Math.min(
        y - height - gap >= top + gap ? y - height - gap : endY + gap,
        bottom - height - gap,
      ),
    ),
  };
}

export function commentThreads(comments) {
  return comments.map((comment) => ({
    id: comment.id,
    element: comment.target.element,
    comment,
  }));
}

export function commentAppliesToVersion(
  comment,
  proposals,
  viewedProposalId,
  anchors,
) {
  const resolution = anchors?.[comment.id];
  if (!["exact", "recovered"].includes(resolution?.status)) return false;
  const origins = new Set(
      proposals
        .filter((proposal) => proposal.revision === comment.target.revision)
        .map((proposal) => proposal.id),
    ),
    byId = new Map(proposals.map((proposal) => [proposal.id, proposal])),
    visited = new Set();
  let cursor = viewedProposalId;
  while (cursor && !visited.has(cursor)) {
    if (origins.has(cursor)) return true;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parent;
  }
  return false;
}

export function annotationEventFromFrame(event, source, frame, previewState) {
  if (
    !frame ||
    previewState.status !== "ready" ||
    event.source !== source ||
    event.origin !== "null" ||
    event.data?.capability !== frame.capability ||
    event.data.revision !== frame.revision ||
    !["dstar-annotation-focus", "dstar-annotation-clear"].includes(
      event.data.kind,
    ) ||
    (event.data.kind === "dstar-annotation-focus" &&
      typeof event.data.group !== "string")
  )
    return null;
  return event.data;
}
