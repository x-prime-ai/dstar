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
      ["comment", "suggest"].includes(action.kind) &&
      action.target === target
        ? {
            kind: action.kind,
            target: selection,
            ...(typeof action.draft === "string"
              ? { draft: action.draft }
              : {}),
          }
        : null,
  };
}

export function agentHandoffPrompt(
  kind,
  viewerUrl,
  selectorType = "text-range",
) {
  if (!["comment", "suggest"].includes(kind))
    throw new Error("Unsupported agent handoff action");
  const url = new URL(viewerUrl);
  if (!url.hash || !url.searchParams.get("handoff"))
    throw new Error("Agent handoff link is incomplete");
  return [
    `Open this private, short-lived DSTAR handoff link in the in-app browser: ${url.href}`,
    `Call get_review_context and confirm action.kind is "${kind}". Follow the user's instruction in this chat.`,
    kind === "comment"
      ? "Use draft_selection_comment to return an editable comment draft. Do not post, resolve, accept, or reject anything."
      : selectorType === "text-range"
        ? "Use draft_selection_suggestion to return editable replacement text. An empty replacement means delete the selection. Do not submit, accept, reject, or resolve anything."
        : "This structural or multi-element suggestion cannot use the text draft tool. You may use propose_revision to create a pending proposal for human review; do not accept, reject, or resolve anything.",
  ].join("\n");
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

// State comments are append-only: keep location numbers stable when new threads
// arrive or existing threads are resolved, including across preview versions.
export function commentGroups(comments) {
  const groups = new Map();
  for (const comment of comments) {
    const id = comment.target.element;
    if (!groups.has(id))
      groups.set(id, {
        id,
        number: groups.size + 1,
        comments: [],
        openCount: 0,
      });
    const group = groups.get(id);
    group.comments.push(comment);
    if (comment.status === "open") group.openCount++;
  }
  return [...groups.values()];
}

export function annotationEventFromFrame(event, source, frame, previewState) {
  if (
    !frame ||
    previewState.status !== "ready" ||
    event.source !== source ||
    event.origin !== "null" ||
    event.data?.capability !== frame.capability ||
    event.data.revision !== frame.revision ||
    event.data.kind !== "dstar-annotation-focus" ||
    typeof event.data.group !== "string"
  )
    return null;
  return event.data;
}
