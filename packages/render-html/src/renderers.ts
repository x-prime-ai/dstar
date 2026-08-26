import {
  createDiagnostic,
  projectionRevision,
  type Diagnostic,
  type DstarInline,
  type DstarProjection,
} from "@dstar/core";
import type { PackageSnapshot } from "@dstar/node";

import { resolveSafeImage } from "./assets.js";
import {
  buildRenderTree,
  defaultProfileRegistry,
  type CanonicalTextRunDescriptor,
  type ProfileRegistry,
  type RenderNode,
  type RenderTree,
} from "./render-tree.js";
import {
  assertSafeGeneratedHtml,
  escapeAttribute,
  escapeHtml,
  READER_CSP,
  safeLink,
} from "./safety.js";

export type ProjectionKind = "html" | "markdown" | "plain-text";
export type ProjectionSegment = NonNullable<
  DstarProjection["segments"]
>[number];

export interface CanonicalHtmlResult {
  readonly documentRevision: string;
  readonly bytes: Uint8Array;
  readonly html: string;
  readonly nodeOrder: readonly string[];
  readonly textRuns: readonly CanonicalTextRunDescriptor[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface RenderedProjection {
  readonly kind: ProjectionKind;
  readonly mediaType: string;
  readonly role: string;
  readonly extension: string;
  readonly bytes: Uint8Array;
  readonly revision: string;
  readonly segments: readonly ProjectionSegment[];
  readonly reviewable: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const encoder = new TextEncoder();

function codePoints(value: string): number {
  return [...value].length;
}

function boundedJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? "null";
  return json.length <= 4_096 ? json : `${json.slice(0, 4_096)}\n…`;
}

function markHtml(value: string, inline: DstarInline): string {
  let output = value;
  for (const mark of inline.marks ?? []) {
    switch (mark.type) {
      case "strong":
        output = `<strong>${output}</strong>`;
        break;
      case "emphasis":
        output = `<em>${output}</em>`;
        break;
      case "code":
        output = `<code>${output}</code>`;
        break;
      case "link": {
        const href =
          typeof mark.attrs?.href === "string"
            ? safeLink(mark.attrs.href)
            : undefined;
        output = href
          ? `<a href="${escapeAttribute(href)}" rel="noopener noreferrer" target="_blank">${output}</a>`
          : `<span class="dstar-unsafe-link" title="Unsafe link removed">${output}</span>`;
        break;
      }
      default:
        output = `<span class="dstar-unsupported-mark" data-dstar-unsupported-mark="${escapeAttribute(mark.type)}" title="Unsupported mark: ${escapeAttribute(mark.type)}">${output}</span>`;
    }
  }
  return output;
}

function inlineHtml(node: RenderNode, descriptors: boolean): string {
  return node.textRuns
    .map((run) => {
      const inline = run.inline;
      const text =
        inline.type === "text" && typeof inline.text === "string"
          ? escapeHtml(inline.text)
          : `<span class="dstar-inline-fallback">${escapeHtml(boundedJson(inline))}</span>`;
      const marked = markHtml(text, inline);
      return descriptors
        ? `<span data-dstar-end="${run.end}" data-dstar-start="${run.start}" data-dstar-text-run="${escapeAttribute(run.id)}">${marked}</span>`
        : marked;
    })
    .join("");
}

function fallbackHtml(node: RenderNode, attributes: string): string {
  return `<aside ${attributes} class="dstar-unsupported" role="note"><strong>Unsupported content: ${escapeHtml(node.type)}</strong><div>Node ${escapeHtml(node.id)} is preserved but cannot be rendered by the installed profile adapters.</div><pre>${escapeHtml(boundedJson(node.node))}</pre></aside>`;
}

function safeImageHtml(
  snapshot: PackageSnapshot,
  node: RenderNode,
  attributes: string,
  diagnostics: Diagnostic[],
): string {
  const src =
    typeof node.node.attrs?.src === "string" ? node.node.attrs.src : "";
  const alt =
    typeof node.node.attrs?.alt === "string" ? node.node.attrs.alt : "Image";
  const asset = resolveSafeImage(snapshot, src);
  if (!asset) {
    diagnostics.push(
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: "warning",
        summary: `Image ${node.id} uses a missing, active, or unsupported asset and was rendered as a visible fallback.`,
        location: { objectId: node.id, ...(src ? { packagePath: src } : {}) },
      }),
    );
    return `<figure ${attributes} class="dstar-asset-fallback" role="note"><strong>Image unavailable</strong><figcaption>${escapeHtml(alt)}</figcaption><div>${escapeHtml(src || "No asset path")}</div></figure>`;
  }
  return `<figure ${attributes}><img alt="${escapeAttribute(alt)}" src="../${escapeAttribute(asset.path)}"><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
}

function nodeHtml(
  snapshot: PackageSnapshot,
  node: RenderNode,
  mode: "canonical" | "projection",
  segmentId: string | undefined,
  diagnostics: Diagnostic[],
): string {
  if (node.type === "document") {
    const articleAttributes =
      mode === "canonical"
        ? ` data-dstar-node="${escapeAttribute(node.id)}"`
        : "";
    return `<article${articleAttributes}>${node.children
      .map((child) =>
        nodeHtml(
          snapshot,
          child,
          mode,
          mode === "projection" ? segmentIdFor(mode, child.id) : undefined,
          diagnostics,
        ),
      )
      .join("")}</article>`;
  }
  const attributes =
    mode === "canonical"
      ? `data-dstar-node="${escapeAttribute(node.id)}"`
      : `data-dstar-segment="${escapeAttribute(segmentId ?? "")}"`;
  if (!node.supported) return fallbackHtml(node, attributes);
  if (node.type === "heading") {
    const level = Number(node.node.attrs?.level);
    return `<h${level} ${attributes}>${inlineHtml(node, mode === "canonical") || `<span class="dstar-empty">Empty heading ${escapeHtml(node.id)}</span>`}</h${level}>`;
  }
  if (node.type === "paragraph")
    return `<p ${attributes}>${inlineHtml(node, mode === "canonical") || `<span class="dstar-empty">Empty paragraph ${escapeHtml(node.id)}</span>`}</p>`;
  if (node.type === "image")
    return safeImageHtml(snapshot, node, attributes, diagnostics);
  return fallbackHtml(node, attributes);
}

function segmentIdFor(kind: string, nodeId: string): string {
  const safe = nodeId.replaceAll(/[^A-Za-z0-9._:-]/gu, "_");
  return `segment_${kind}_${safe}`;
}

function meaningfulNodes(tree: RenderTree): readonly RenderNode[] {
  const output: RenderNode[] = [];
  const visit = (node: RenderNode): void => {
    if (node.type !== "document") output.push(node);
    if (node.supported) for (const child of node.children) visit(child);
  };
  visit(tree.root);
  return output;
}

function canonicalTarget(node: RenderNode, relation: "exact" | "transformed") {
  return {
    relation,
    selector: { type: "NodeSelector" as const, node: node.id },
  };
}

function htmlDocument(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta content="${escapeAttribute(READER_CSP)}" http-equiv="Content-Security-Policy">`,
    '<meta content="width=device-width, initial-scale=1" name="viewport">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0 auto;max-width:72ch;padding:2rem;line-height:1.55}img{height:auto;max-width:100%}pre{overflow:auto;white-space:pre-wrap}.dstar-unsupported,.dstar-asset-fallback{border:2px solid #b66;padding:1rem}.dstar-unsupported-mark,.dstar-unsafe-link{text-decoration:underline wavy #b66}</style>",
    "</head>",
    `<body>${body}</body>`,
    "</html>",
    "",
  ].join("\n");
}

function documentTitle(snapshot: PackageSnapshot, tree: RenderTree): string {
  const firstHeading = meaningfulNodes(tree).find(
    (node) => node.type === "heading" && node.text,
  );
  return firstHeading?.text ?? snapshot.manifest.title;
}

export function renderCanonicalHtml(
  snapshot: PackageSnapshot,
  registry: ProfileRegistry = defaultProfileRegistry(),
): CanonicalHtmlResult {
  const tree = buildRenderTree(
    snapshot.document,
    snapshot.manifest.profiles,
    registry,
  );
  const diagnostics = [...tree.diagnostics];
  const body = nodeHtml(
    snapshot,
    tree.root,
    "canonical",
    undefined,
    diagnostics,
  );
  const html = htmlDocument(documentTitle(snapshot, tree), body);
  assertSafeGeneratedHtml(html);
  return Object.freeze({
    documentRevision: snapshot.manifest.revision,
    bytes: encoder.encode(html),
    html,
    nodeOrder: tree.nodeOrder,
    textRuns: tree.textRuns,
    diagnostics: Object.freeze(diagnostics),
  });
}

function htmlProjection(
  snapshot: PackageSnapshot,
  tree: RenderTree,
): RenderedProjection {
  const diagnostics = [...tree.diagnostics];
  const nodes = meaningfulNodes(tree);
  const body = nodeHtml(
    snapshot,
    tree.root,
    "projection",
    undefined,
    diagnostics,
  );
  const html = htmlDocument(documentTitle(snapshot, tree), body);
  assertSafeGeneratedHtml(html);
  const segments: ProjectionSegment[] = nodes.map((node) => {
    const id = segmentIdFor("projection", node.id);
    const quote =
      node.text ||
      (node.type === "heading" || node.type === "paragraph"
        ? `Empty ${node.type} ${node.id}`
        : typeof node.node.attrs?.alt === "string"
          ? node.node.attrs.alt
          : `Unsupported content: ${node.type}`);
    return {
      id,
      selectors: [
        { type: "FragmentSelector", value: id },
        { type: "TextQuoteSelector", exact: quote },
      ],
      derivedFrom: [
        canonicalTarget(
          node,
          node.supported && node.type !== "image" ? "exact" : "transformed",
        ),
      ],
    };
  });
  return result(
    "html",
    "text/html",
    "reading",
    "html",
    html,
    segments,
    diagnostics,
  );
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/([\\`*_{}<>#|]|\[|\])/gu, "\\$1");
}

function markdownInline(inline: DstarInline): {
  text: string;
  transformed: boolean;
} {
  let output = escapeMarkdown(
    typeof inline.text === "string" ? inline.text : boundedJson(inline),
  );
  let transformed = output !== inline.text;
  for (const mark of inline.marks ?? []) {
    transformed = true;
    if (mark.type === "strong") output = `**${output}**`;
    else if (mark.type === "emphasis") output = `_${output}_`;
    else if (mark.type === "code")
      output = `\`${output.replaceAll("`", "\\`")}\``;
    else if (mark.type === "link") {
      const href =
        typeof mark.attrs?.href === "string"
          ? safeLink(mark.attrs.href)
          : undefined;
      output = href
        ? `[${output}](${href.replaceAll(")", "%29")})`
        : `${output} [unsafe link removed]`;
    } else
      output = `${output} [unsupported mark: ${escapeMarkdown(mark.type)}]`;
  }
  return { text: output, transformed };
}

function markdownNode(
  snapshot: PackageSnapshot,
  node: RenderNode,
): { text: string; exact: boolean } {
  if (!node.supported)
    return {
      text: `> Unsupported content ${escapeMarkdown(node.type)} (${escapeMarkdown(node.id)})\n>\n> ${escapeMarkdown(boundedJson(node.node)).replaceAll("\n", "\n> ")}`,
      exact: false,
    };
  if (node.type === "heading") {
    const inline = (node.node.content ?? []).map(markdownInline);
    return {
      text: `${"#".repeat(Number(node.node.attrs?.level))} ${inline.map((item) => item.text).join("")}`,
      exact: false,
    };
  }
  if (node.type === "paragraph") {
    const inline = (node.node.content ?? []).map(markdownInline);
    const text = inline.map((item) => item.text).join("");
    return {
      text: text || `[Empty paragraph ${node.id}]`,
      exact: text === node.text && inline.every((item) => !item.transformed),
    };
  }
  if (node.type === "image") {
    const src =
      typeof node.node.attrs?.src === "string" ? node.node.attrs.src : "";
    const alt =
      typeof node.node.attrs?.alt === "string" ? node.node.attrs.alt : "Image";
    return resolveSafeImage(snapshot, src)
      ? {
          text: `![${escapeMarkdown(alt)}](../${src.replaceAll(")", "%29")})`,
          exact: false,
        }
      : {
          text: `[Image unavailable: ${escapeMarkdown(alt)} (${escapeMarkdown(src)})]`,
          exact: false,
        };
  }
  return {
    text: `Unsupported content ${node.type} (${node.id})`,
    exact: false,
  };
}

function textNode(node: RenderNode): { text: string; exact: boolean } {
  if (!node.supported)
    return {
      text: `Unsupported content ${node.type} (${node.id}): ${boundedJson(node.node)}`,
      exact: false,
    };
  if (node.type === "heading" || node.type === "paragraph")
    return {
      text: node.text || `Empty ${node.type} ${node.id}`,
      exact: node.text.length > 0,
    };
  if (node.type === "image") {
    const alt =
      typeof node.node.attrs?.alt === "string" ? node.node.attrs.alt : "Image";
    return { text: `Image: ${alt}`, exact: false };
  }
  return {
    text: `Unsupported content ${node.type} (${node.id})`,
    exact: false,
  };
}

function textProjection(
  snapshot: PackageSnapshot,
  tree: RenderTree,
  kind: "markdown" | "plain-text",
): RenderedProjection {
  const nodes = meaningfulNodes(tree);
  let output = "";
  const segments: ProjectionSegment[] = [];
  for (const node of nodes) {
    if (output) output += kind === "markdown" ? "\n\n" : "\n";
    const start = codePoints(output);
    const rendered =
      kind === "markdown" ? markdownNode(snapshot, node) : textNode(node);
    output += rendered.text;
    const end = codePoints(output);
    segments.push({
      id: segmentIdFor(kind, node.id),
      selectors: [
        {
          type: "TextPositionSelector",
          start,
          end,
          unit: "unicode-code-point",
        },
        { type: "TextQuoteSelector", exact: rendered.text },
      ],
      derivedFrom: [
        canonicalTarget(node, rendered.exact ? "exact" : "transformed"),
      ],
    });
  }
  output += "\n";
  return result(
    kind,
    kind === "markdown" ? "text/markdown" : "text/plain",
    kind === "markdown" ? "source" : "plain-text",
    kind === "markdown" ? "md" : "txt",
    output,
    segments,
    tree.diagnostics,
  );
}

function result(
  kind: ProjectionKind,
  mediaType: string,
  role: string,
  extension: string,
  value: string,
  segments: readonly ProjectionSegment[],
  diagnostics: readonly Diagnostic[],
): RenderedProjection {
  const bytes = encoder.encode(value);
  for (const segment of segments) {
    const position = segment.selectors.find(
      (selector) => selector.type === "TextPositionSelector",
    );
    const quote = segment.selectors.find(
      (selector) => selector.type === "TextQuoteSelector",
    );
    if (
      position?.type === "TextPositionSelector" &&
      quote?.type === "TextQuoteSelector"
    ) {
      const slice = [...value].slice(position.start, position.end).join("");
      if (slice !== quote.exact)
        throw new Error(`Projection segment ${segment.id} quotation mismatch`);
    }
  }
  return Object.freeze({
    kind,
    mediaType,
    role,
    extension,
    bytes,
    revision: projectionRevision(bytes),
    segments: Object.freeze([...segments]),
    reviewable: segments.length > 0,
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function renderProjection(
  snapshot: PackageSnapshot,
  kind: ProjectionKind,
  registry: ProfileRegistry = defaultProfileRegistry(),
): RenderedProjection {
  const tree = buildRenderTree(
    snapshot.document,
    snapshot.manifest.profiles,
    registry,
  );
  if (kind === "html") return htmlProjection(snapshot, tree);
  return textProjection(snapshot, tree, kind);
}
