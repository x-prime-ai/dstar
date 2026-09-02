export const VERSION_STATE_SCHEMA = 1;
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_STYLES_BYTES = 128 * 1024;

const encoder = new TextEncoder();

export async function revisionOf(html, css) {
  const bytes = encoder.encode(`${html}\u0000${css}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function initialVersionState(current) {
  return {
    schema: VERSION_STATE_SCHEMA,
    current,
    proposals: [],
    history: [],
  };
}

export function normalizeVersionState(value, fallback) {
  if (
    !value ||
    value.schema !== VERSION_STATE_SCHEMA ||
    !value.current ||
    typeof value.current.html !== "string" ||
    typeof value.current.css !== "string" ||
    typeof value.current.revision !== "string"
  )
    return initialVersionState(fallback);
  return {
    schema: VERSION_STATE_SCHEMA,
    current: value.current,
    proposals: Array.isArray(value.proposals) ? value.proposals : [],
    history: Array.isArray(value.history) ? value.history : [],
  };
}

export function validateCandidateFiles(files) {
  if (!Array.isArray(files)) return ["files must be an array"];
  const paths = new Set();
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    )
      return ["each file must contain string path and content fields"];
    if (paths.has(file.path)) return [`duplicate file: ${file.path}`];
    paths.add(file.path);
  }
  if (!paths.has("document.html")) return ["document.html is required"];
  const html = files.find((file) => file.path === "document.html").content;
  const css = files.find((file) => file.path === "styles.css")?.content || "";
  const errors = [];
  if (encoder.encode(html).byteLength > MAX_DOCUMENT_BYTES)
    errors.push("document.html exceeds 512 KiB");
  if (encoder.encode(css).byteLength > MAX_STYLES_BYTES)
    errors.push("styles.css exceeds 128 KiB");
  const unsupported = [...paths].filter(
    (path) => path !== "document.html" && path !== "styles.css",
  );
  if (unsupported.length)
    errors.push(`unsupported files: ${unsupported.join(", ")}`);
  return errors;
}

export function decideProposal(state, proposalId, decision, decidedAt) {
  if (decision !== "accepted" && decision !== "rejected")
    throw new Error("Invalid decision");
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending")
    throw new Error("Pending proposal not found");
  const proposals = state.proposals.map((item) =>
    item.id === proposalId ? { ...item, status: decision, decidedAt } : item,
  );
  if (decision === "rejected") return { ...state, proposals };
  return {
    ...state,
    current: {
      revision: proposal.revision,
      html: proposal.html,
      css: proposal.css,
      acceptedAt: decidedAt,
      proposalId,
    },
    proposals,
    history: [state.current, ...state.history],
  };
}
