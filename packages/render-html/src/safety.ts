import {
  createDiagnostic,
  validatePackagePath,
  type Diagnostic,
  type DstarProjection,
} from "@dstar/core";
import sanitizeHtml from "sanitize-html";

const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const FORBIDDEN_HTML = [
  /<script\b/iu,
  /<form\b/iu,
  /<iframe\b/iu,
  /<object\b/iu,
  /<embed\b/iu,
  /<base\b/iu,
  /<[^>]+\son[a-z]+\s*=/iu,
  /(?:href|src)\s*=\s*["']\s*(?:javascript|vbscript)\s*:/iu,
  /<svg\b/iu,
];

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

export function safeLink(href: string): string | undefined {
  const packagePath = validatePackagePath(href);
  if (packagePath.valid) return href;
  try {
    const url = new URL(href);
    return SAFE_LINK_SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function assertSafeGeneratedHtml(html: string): void {
  for (const forbidden of FORBIDDEN_HTML) {
    if (forbidden.test(html))
      throw new Error(
        `Generated HTML failed the active-content allowlist: ${forbidden.source}`,
      );
  }
}

/** Treat arbitrary HTML as text. Canonical content is never parsed as markup. */
export function sanitizeUntrustedHtml(value: string): string {
  return escapeHtml(value);
}

export const READER_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export interface SanitizedProjectionHtml {
  readonly html: string;
  readonly reviewable: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ValidatedTextProjection {
  readonly text: string;
  readonly reviewable: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const STORED_HTML_TAGS = [
  "html",
  "head",
  "title",
  "body",
  "article",
  "section",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "ol",
  "ul",
  "li",
  "pre",
  "code",
  "strong",
  "em",
  "a",
  "figure",
  "figcaption",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
  "div",
  "br",
];

function visibleHtml(value: string): string {
  return value
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

export function sanitizeStoredProjectionHtml(
  bytes: Uint8Array,
  projection: DstarProjection,
): SanitizedProjectionHtml {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const sanitizedDocument = sanitizeHtml(source, {
    allowedTags: STORED_HTML_TAGS,
    allowedAttributes: {
      a: ["href", "rel", "target"],
      img: ["alt"],
      "*": [
        "class",
        "role",
        "aria-label",
        "aria-labelledby",
        "lang",
        "data-dstar-segment",
      ],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...(attributes.href ? { href: attributes.href } : {}),
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      img: (_tagName, attributes) => ({
        tagName: "img",
        attribs: { ...(attributes.alt ? { alt: attributes.alt } : {}) },
      }),
    },
  });
  const diagnostics: Diagnostic[] = [];
  if (sanitizedDocument !== source)
    diagnostics.push(
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: "warning",
        summary:
          "Stored projection markup was reduced to the DSTAR active-content allowlist.",
        location: { objectId: projection.id, packagePath: projection.path },
      }),
    );
  let reviewable =
    projection.reviewable && (projection.segments?.length ?? 0) > 0;
  const fragments: string[] = [];
  for (const segment of projection.segments ?? []) {
    const fragment = segment.selectors.find(
      (selector) => selector.type === "FragmentSelector",
    );
    const quote = segment.selectors.find(
      (selector) => selector.type === "TextQuoteSelector",
    );
    const escapedFragment =
      fragment?.type === "FragmentSelector"
        ? fragment.value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")
        : "";
    const sourceElement = escapedFragment
      ? source.match(
          new RegExp(
            `<([a-z][a-z0-9]*)[^>]*data-dstar-segment=["']${escapedFragment}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
            "iu",
          ),
        )
      : undefined;
    const safeFragment = sourceElement
      ? sanitizeHtml(sourceElement[0], {
          allowedTags: STORED_HTML_TAGS,
          allowedAttributes: {
            a: ["href", "rel", "target"],
            img: ["alt"],
            "*": [
              "class",
              "role",
              "aria-label",
              "aria-labelledby",
              "lang",
              "data-dstar-segment",
            ],
          },
          allowedSchemes: ["http", "https", "mailto"],
          allowProtocolRelative: false,
          disallowedTagsMode: "discard",
          enforceHtmlBoundary: true,
          transformTags: {
            a: (_tagName, attributes) => ({
              tagName: "a",
              attribs: {
                ...(attributes.href ? { href: attributes.href } : {}),
                rel: "noopener noreferrer",
                target: "_blank",
              },
            }),
            img: (_tagName, attributes) => ({
              tagName: "img",
              attribs: { ...(attributes.alt ? { alt: attributes.alt } : {}) },
            }),
          },
        })
      : undefined;
    if (
      !safeFragment ||
      safeFragment.split(
        `data-dstar-segment="${escapeAttribute(fragment?.type === "FragmentSelector" ? fragment.value : "")}"`,
      ).length !== 2 ||
      (quote?.type === "TextQuoteSelector" &&
        !visibleHtml(safeFragment).includes(quote.exact))
    ) {
      reviewable = false;
      diagnostics.push(
        createDiagnostic("PROFILE_UNSUPPORTED", {
          severity: "warning",
          summary: `Stored projection segment ${segment.id} did not survive safe mapping validation.`,
          location: { objectId: projection.id, packagePath: projection.path },
        }),
      );
    } else fragments.push(safeFragment);
  }
  const html = reviewable
    ? `<!doctype html><html><head><meta charset="utf-8"><meta content="${escapeAttribute(READER_CSP)}" http-equiv="Content-Security-Policy"></head><body><article>${fragments.join("")}</article></body></html>`
    : sanitizedDocument;
  return {
    html,
    reviewable,
    diagnostics: Object.freeze(diagnostics),
  };
}

export function validateStoredTextProjection(
  bytes: Uint8Array,
  projection: DstarProjection,
): ValidatedTextProjection {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const points = [...text];
  const diagnostics: Diagnostic[] = [];
  let reviewable =
    projection.reviewable && (projection.segments?.length ?? 0) > 0;
  let cursor = 0;
  for (const segment of projection.segments ?? []) {
    const position = segment.selectors.find(
      (selector) => selector.type === "TextPositionSelector",
    );
    const quote = segment.selectors.find(
      (selector) => selector.type === "TextQuoteSelector",
    );
    if (
      position?.type !== "TextPositionSelector" ||
      quote?.type !== "TextQuoteSelector" ||
      position.start < cursor ||
      points.slice(position.start, position.end).join("") !== quote.exact ||
      points.slice(cursor, position.start).join("").trim().length > 0
    ) {
      reviewable = false;
      diagnostics.push(
        createDiagnostic("PROFILE_UNSUPPORTED", {
          severity: "warning",
          summary: `Stored text projection segment ${segment.id} failed position, quotation, order, or coverage validation.`,
          location: { objectId: projection.id, packagePath: projection.path },
        }),
      );
    }
    if (position?.type === "TextPositionSelector") cursor = position.end;
  }
  if (points.slice(cursor).join("").trim().length > 0) {
    reviewable = false;
    diagnostics.push(
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: "warning",
        summary: "Stored text projection contains meaningful unmapped content.",
        location: { objectId: projection.id, packagePath: projection.path },
      }),
    );
  }
  return { text, reviewable, diagnostics: Object.freeze(diagnostics) };
}
