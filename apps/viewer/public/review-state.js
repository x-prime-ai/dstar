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
  if (
    !frame ||
    previewState.status !== "ready" ||
    event.source !== source ||
    event.origin !== "null" ||
    event.data?.kind !== "dstar-selection" ||
    event.data.capability !== frame.capability ||
    event.data.target?.revision !== frame.revision
  )
    return null;
  const target = event.data.target;
  if (
    typeof target.element !== "string" ||
    !["element", "text-range"].includes(target.selector?.type) ||
    (target.selector.type === "text-range" &&
      typeof target.selector.exact !== "string")
  )
    return null;
  return target;
}
