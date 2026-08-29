// Diff reads are immutable and scoped to a changed canonical path, never a host
// filesystem path. Keep large documents bounded and disclose any omitted text.
export function fileDiff(before, after, proposal, path) {
  const file = proposal.diff.files.find((entry) => entry.path === path);
  if (!file) throw new Error("Choose a changed file from this version.");
  const isText = /\.(html|css)$/.test(path);
  const side = (snapshot) => {
    const bytes = snapshot?.files.get(path);
    const omitted = isText && bytes?.length > 512 * 1024;
    return {
      exists: !!bytes,
      bytes: bytes?.length ?? 0,
      omitted: !!omitted,
      text: isText && !omitted ? (bytes?.toString("utf8") ?? "") : null,
    };
  };
  let remaining = 200000;
  const element = (snapshot, id) => {
    const value = snapshot?.index?.elements[id];
    if (!value) return null;
    const chars = [...value.text];
    const size = Math.min(chars.length, 8000, remaining);
    remaining -= size;
    return {
      tag: value.tag,
      text: chars.slice(0, size).join(""),
      truncated: size < chars.length,
    };
  };
  return {
    proposalId: proposal.id,
    base: proposal.base,
    revision: proposal.revision,
    path,
    kind: file.kind,
    isText,
    before: side(before),
    after: side(after),
    elementChangeCount:
      path === "document.html" ? proposal.diff.elementChangeCount : 0,
    elements:
      path === "document.html"
        ? proposal.diff.elements.map((change) => ({
            id: change.id,
            changes: change.changes,
            before: element(before, change.id),
            after: element(after, change.id),
          }))
        : [],
  };
}
