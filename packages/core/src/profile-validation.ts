import { createDiagnostic, type Diagnostic } from "./diagnostics.js";
import { DocumentIndex, nodeTextStream } from "./indexes.js";
import { isPackagePath } from "./paths.js";
import type {
  DstarDocument,
  DstarInline,
  DstarMark,
  DstarNode,
} from "./protocol.js";

const COMPLETE_BASE_NODE_TYPES = new Set([
  "document",
  "heading",
  "paragraph",
  "image",
]);
const RESERVED_INCOMPLETE_BASE_NODE_TYPES = new Set([
  "section",
  "blockquote",
  "list",
  "list_item",
  "code_block",
  "table",
  "table_row",
  "table_cell",
  "embed",
]);
const BASE_MARK_TYPES = new Set(["strong", "emphasis", "code", "link"]);

function invalid(
  summary: string,
  node: DstarNode,
  pointer?: string,
): Diagnostic {
  return createDiagnostic("PROFILE_UNSUPPORTED", {
    severity: "error",
    summary,
    location: { objectId: node.id, ...(pointer ? { pointer } : {}) },
  });
}

function validateMark(
  mark: DstarMark,
  node: DstarNode,
  profiles: readonly string[],
): Diagnostic[] {
  if (!BASE_MARK_TYPES.has(mark.type)) {
    return [
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: profiles.length > 1 ? "warning" : "error",
        summary: `Mark type ${mark.type} is not defined by dstar:base.`,
        location: { objectId: node.id },
      }),
    ];
  }
  if (mark.type === "link") {
    const href = mark.attrs?.href;
    if (typeof href !== "string" || href.length === 0) {
      return [
        invalid("A link mark requires a non-empty href attribute.", node),
      ];
    }
  }
  return [];
}

function validateInline(
  inline: DstarInline,
  node: DstarNode,
  profiles: readonly string[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (inline.type === "text") {
    if (typeof inline.text !== "string")
      diagnostics.push(invalid("A text inline requires text.", node));
  } else {
    diagnostics.push(
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: profiles.length > 1 ? "warning" : "error",
        summary: `Inline type ${inline.type} is not defined by dstar:base.`,
        location: { objectId: node.id },
      }),
    );
  }
  for (const mark of inline.marks ?? [])
    diagnostics.push(...validateMark(mark, node, profiles));
  return diagnostics;
}

export function validateBaseProfile(
  document: DstarDocument,
  profiles: readonly string[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!profiles.includes("dstar:base")) {
    diagnostics.push(
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: "error",
        summary: "Every DSTAR 0.1 package must declare dstar:base.",
      }),
    );
  }

  let index: DocumentIndex;
  try {
    index = new DocumentIndex(document);
  } catch (error) {
    diagnostics.push(
      createDiagnostic("REF_DUPLICATE_ID", {
        summary:
          error instanceof Error
            ? error.message
            : "Duplicate document node ID.",
      }),
    );
    return Object.freeze(diagnostics);
  }

  if (document.type !== "document") {
    diagnostics.push(
      invalid("The root node must have type document.", document),
    );
  }

  for (const node of index.nodes.values()) {
    if (RESERVED_INCOMPLETE_BASE_NODE_TYPES.has(node.type)) {
      diagnostics.push(
        createDiagnostic("PROFILE_UNSUPPORTED", {
          severity: "error",
          summary: `Base node ${node.type} is reserved but has no complete 0.1 rules.`,
          location: { objectId: node.id },
        }),
      );
      continue;
    }
    if (!COMPLETE_BASE_NODE_TYPES.has(node.type)) {
      diagnostics.push(
        createDiagnostic("PROFILE_UNSUPPORTED", {
          severity: profiles.length > 1 ? "warning" : "error",
          summary: `Node type ${node.type} is not defined by dstar:base.`,
          location: { objectId: node.id },
        }),
      );
      continue;
    }

    if (node.type === "document") {
      if (node.id !== document.id)
        diagnostics.push(invalid("Only the root may use type document.", node));
      if (node.content !== undefined)
        diagnostics.push(
          invalid("A document node cannot contain inline content.", node),
        );
    } else if (node.type === "heading") {
      const level = node.attrs?.level;
      if (
        !Number.isInteger(level) ||
        (level as number) < 1 ||
        (level as number) > 6
      ) {
        diagnostics.push(
          invalid(
            "A heading requires an integer level from 1 through 6.",
            node,
          ),
        );
      }
      if (node.children !== undefined)
        diagnostics.push(
          invalid("A heading cannot contain child nodes.", node),
        );
    } else if (node.type === "paragraph") {
      if (node.children !== undefined)
        diagnostics.push(
          invalid("A paragraph cannot contain child nodes.", node),
        );
    } else if (node.type === "image") {
      if (node.children !== undefined || node.content !== undefined) {
        diagnostics.push(
          invalid(
            "An image is a leaf and cannot contain content or children.",
            node,
          ),
        );
      }
      if (
        typeof node.attrs?.src !== "string" ||
        !isPackagePath(node.attrs.src)
      ) {
        diagnostics.push(
          invalid("An image requires a valid package-relative src.", node),
        );
      }
      if (typeof node.attrs?.alt !== "string" || node.attrs.alt.length === 0) {
        diagnostics.push(
          invalid("An image requires human-readable alt text.", node),
        );
      }
    }

    for (const inline of node.content ?? [])
      diagnostics.push(...validateInline(inline, node, profiles));
    void nodeTextStream(node);
  }
  return Object.freeze(diagnostics);
}
