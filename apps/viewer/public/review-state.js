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
) {
  const revision =
    selected && (showingBase ? selected.base : selected.revision);
  const status = frame?.revision === revision ? previewState.status : "loading";
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
    selection:
      status === "ready" && target?.revision === revision ? target : null,
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

export function selectionButtonPosition(rect, frame, viewport) {
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
  const size = 38,
    gap = 8;
  if (
    endX <= left ||
    x >= right ||
    endY <= top ||
    y >= bottom ||
    right - left < size + gap * 2 ||
    bottom - top < size + gap * 2
  )
    return null;
  return {
    left: Math.max(
      left + gap,
      Math.min((x + endX - size) / 2, right - size - gap),
    ),
    top: Math.max(
      top + gap,
      Math.min(
        y - size - gap >= top + gap ? y - size - gap : endY + gap,
        bottom - size - gap,
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
