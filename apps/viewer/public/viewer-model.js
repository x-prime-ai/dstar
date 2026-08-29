const newestFirst = (items) => [...items].reverse();

export function versionGroups(state) {
  const proposals = state?.proposals ?? [];
  return {
    suggested: newestFirst(
      proposals.filter((item) => item.status === "pending"),
    ),
    current: proposals.find((item) => item.id === state?.head) ?? null,
    previous: newestFirst(
      proposals.filter(
        (item) => item.status === "accepted" && item.id !== state?.head,
      ),
    ),
    declined: newestFirst(
      proposals.filter((item) => item.status === "rejected"),
    ),
  };
}

export function versionKind(proposal, state) {
  if (!proposal) return "empty";
  if (proposal.status === "pending") return "suggested";
  if (proposal.id === state?.head) return "current";
  if (proposal.status === "accepted") return "previous";
  return "declined";
}

export function versionCopy(proposal, state, showingBefore = false) {
  const kind = versionKind(proposal, state);
  if (kind === "empty")
    return {
      kind,
      badge: "No current version",
      preview: "No current version",
      heading: "Nothing to read yet",
      nextStep: "Review the first suggested change to create this document.",
    };
  if (kind === "suggested")
    return {
      kind,
      badge: "Suggested change",
      preview: showingBefore ? "Before changes" : "After changes",
      heading: proposal.request,
      nextStep:
        proposal.parent === state?.head
          ? "Compare the change, then accept or reject it."
          : "This suggestion is based on an earlier version and cannot be accepted.",
    };
  if (kind === "current")
    return {
      kind,
      badge: "Current version",
      preview: "Current version",
      heading: proposal.request,
      nextStep: "This is the version everyone currently sees.",
    };
  if (kind === "previous")
    return {
      kind,
      badge: "Previous version",
      preview: "Previous version",
      heading: proposal.request,
      nextStep:
        "This version is read-only. Return to the current version to comment.",
    };
  return {
    kind,
    badge: "Declined suggestion",
    preview: "Declined suggestion",
    heading: proposal.request,
    nextStep: "This suggestion was declined and is shown for reference only.",
  };
}

export function changeSummary(proposal) {
  if (!proposal) return "";
  const files = proposal.diff?.files?.length ?? 0;
  const elements = proposal.diff?.elementChangeCount ?? 0;
  return `${elements} changed ${elements === 1 ? "element" : "elements"} in ${files} ${files === 1 ? "file" : "files"}`;
}

export function actorCopy(actor) {
  if (typeof actor === "string") return { name: actor, role: null };
  if (!actor || typeof actor !== "object")
    return { name: "Unknown contributor", role: null };
  return {
    name:
      typeof actor.displayName === "string" && actor.displayName.trim()
        ? actor.displayName
        : typeof actor.id === "string" && actor.id.trim()
          ? actor.id
          : "Unknown contributor",
    role:
      actor.role === "owner"
        ? "Owner"
        : actor.role === "reviewer"
          ? "Reviewer"
          : null,
  };
}

export function technicalVersion(proposal) {
  if (!proposal) return "";
  const base = proposal.base ? proposal.base.slice(7, 19) : "empty document";
  return `Revision ${proposal.revision.slice(7, 19)} · compared with ${base}`;
}
