import { posix } from "node:path";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { isTag, isText, type AnyNode, type Element } from "domhandler";
import postcss from "postcss";
import { digest, MAX_TOTAL } from "./delta.js";
import type {
  Files,
  HtmlIndex,
  Resolution,
  ReviewDiff,
  Target,
  Comment,
  ElementInfo,
} from "./types.js";

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const TAGS = new Set(
  "html head title meta link style body article main section header footer nav aside div span p h1 h2 h3 h4 h5 h6 strong em b i u s del ins mark small sub sup br hr pre code blockquote ul ol li dl dt dd figure figcaption img picture source table caption thead tbody tfoot tr th td colgroup col details summary button a time abbr wbr".split(
    " ",
  ),
);
const ATTRS = new Set(
  "id class style title role lang dir hidden tabindex data-dstar-id data-dstar-mode data-dstar-slide href target rel src alt width height loading decoding type media charset name content colspan rowspan scope datetime open start reversed value span".split(
    " ",
  ),
);
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function filePath(path: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) ||
    path
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith("."))
  )
    throw new Error(`Invalid package path: ${path}`);
  if (!(
    path === "document.html" ||
    path === "styles.css" ||
    (path.startsWith("styles/") && path.endsWith(".css")) ||
    path.startsWith("assets/")
  ))
    throw new Error(`Unsupported canonical path: ${path}`);
  if (
    !MIME[posix.extname(path)] ||
    (path.startsWith("assets/") &&
      [".html", ".css"].includes(posix.extname(path)))
  )
    throw new Error(`Unsupported canonical file type: ${path}`);
  return path;
}
export function mediaType(path: string): string {
  return MIME[posix.extname(path)] ?? "application/octet-stream";
}
export function utf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function assetRef(value: string, from: string, files: Files): void {
  if (!value || /[\\%?#:\s]/.test(value) || value.startsWith("/"))
    throw new Error(`Unsafe asset URL: ${value}`);
  const resolved = posix.normalize(posix.join(posix.dirname(from), value));
  filePath(resolved);
  if (!files.has(resolved)) throw new Error(`Missing asset: ${resolved}`);
}

function validateCss(css: string, from: string, files: Files): void {
  // Escapes and comments can disguise active URLs. This MVP rejects rather than rewrites them.
  if (
    css.includes("\\") ||
    css.includes("/*") ||
    [...css].some(
      (c) => c.charCodeAt(0) < 32 && ![9, 10, 12, 13].includes(c.charCodeAt(0)),
    )
  )
    throw new Error(
      "CSS escapes, comments, or control characters are unsupported",
    );
  const root = postcss.parse(css);
  root.walkAtRules((rule) => {
    if (
      ![
        "media",
        "supports",
        "container",
        "layer",
        "keyframes",
        "font-face",
      ].includes(rule.name.toLowerCase())
    )
      throw new Error(`Unsupported CSS rule: @${rule.name}`);
    if (/url\s*\(/i.test(rule.params))
      throw new Error("URLs in CSS at-rule conditions are unsupported");
  });
  root.walkDecls((decl) => {
    const property = decl.prop.toLowerCase(),
      value = decl.value;
    if (
      ["behavior", "-moz-binding"].includes(property) ||
      /expression\s*\(|image-set\s*\(|src\s*\(/i.test(value)
    )
      throw new Error("Unsafe CSS declaration");
    if (
      property === "content" &&
      !["none", "normal", '""', "''"].includes(value.trim())
    )
      throw new Error("Meaningful generated CSS content is unsupported");
    const urls = [
      ...value.matchAll(
        /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^()\s]*))\s*\)/gi,
      ),
    ];
    if ((value.match(/url\s*\(/gi) ?? []).length !== urls.length)
      throw new Error("Malformed CSS URL");
    for (const m of urls) assetRef(m[1] ?? m[2] ?? m[3] ?? "", from, files);
    if (/https?:|\/\//i.test(value))
      throw new Error("Remote CSS resources are forbidden");
  });
}

function hidden(element: Element): boolean {
  return (
    "hidden" in element.attribs ||
    element.attribs["aria-hidden"] === "true" ||
    ["head", "style", "script"].includes(element.name)
  );
}
/** dom-text-v1: decoded DOM text in order, excluding hidden/head/style subtrees. No layout whitespace is invented. */
export function elementText(element: Element): string {
  if (hidden(element)) return "";
  return element.children
    .map((n) => (isText(n) ? n.data : isTag(n) ? elementText(n) : ""))
    .join("");
}
export function validateHtml(files: Files): HtmlIndex {
  if (!files.has("document.html"))
    throw new Error("Candidate requires document.html");
  for (const [path, bytes] of files) {
    filePath(path);
    if (path.endsWith(".css")) validateCss(utf8(bytes), path, files);
    if (path.startsWith("assets/")) {
      const signatures: Record<string, boolean> = {
        ".png": bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        ".jpg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        ".jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        ".gif": /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()),
        ".webp":
          bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP",
        ".woff": bytes.subarray(0, 4).toString() === "wOFF",
        ".woff2": bytes.subarray(0, 4).toString() === "wOF2",
      };
      if (!signatures[posix.extname(path)])
        throw new Error(`Asset MIME/signature mismatch: ${path}`);
    }
  }
  const html = utf8(files.get("document.html")!);
  // HTML5 preprocessing/tree construction must match browser Range offsets.
  // Only the index is parsed: the original file bytes still define the revision.
  const doc = parse(html, {
    treeAdapter: adapter,
    sourceCodeLocationInfo: true,
  });
  // Check the whole tree before elementText recursively indexes descendants.
  // Checking only during indexing lets a stable ancestor recurse past the cap.
  const pending = doc.children.map((node) => ({ node, depth: 0 }));
  let nodeCount = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++nodeCount > 30000 || depth > 80)
      throw new Error("HTML resource limit exceeded");
    if (isTag(node))
      for (const child of node.children)
        pending.push({ node: child, depth: depth + 1 });
  }
  const elements: HtmlIndex["elements"] = Object.create(null);
  let count = 0,
    elementCount = 0,
    indexedTextSize = 0,
    title = "DSTAR document",
    bodies = 0,
    roots = 0;
  const visit = (
    node: AnyNode,
    parent: string | null,
    depth: number,
    inBody: boolean,
    isHidden: boolean,
  ): void => {
    if (++count > 30000 || depth > 80)
      throw new Error("HTML resource limit exceeded");
    if (isText(node)) {
      if (inBody && !isHidden && node.data.trim() && !parent)
        throw new Error("Meaningful text has no data-dstar-id ancestor");
      return;
    }
    if (!isTag(node)) return;
    if (!TAGS.has(node.name))
      throw new Error(`Unsafe or unsupported HTML element: ${node.name}`);
    if (
      ["html", "head", "body"].includes(node.name) &&
      !adapter.getNodeSourceCodeLocation(node)?.startTag
    )
      throw new Error(`HTML requires an explicit ${node.name} element`);
    if (node.name === "html") roots++;
    if (node.name === "body") bodies++;
    for (const [attr, value] of Object.entries(node.attribs)) {
      if (
        !(ATTRS.has(attr) || /^aria-[a-z-]+$/.test(attr)) ||
        attr.startsWith("on")
      )
        throw new Error(`Unsupported HTML attribute: ${attr}`);
      if (attr === "style") validateCss(`x{${value}}`, "document.html", files);
      if (attr === "src") assetRef(value, "document.html", files);
      if (attr === "href") {
        if (node.name === "link") assetRef(value, "document.html", files);
        else if (
          node.name !== "a" ||
          !(value.startsWith("#") || /^https:\/\/[^\s]+$/.test(value))
        )
          throw new Error(
            "Only fragment and HTTPS navigation links are supported",
          );
      }
    }
    if (
      node.name === "meta" &&
      !(
        node.attribs.charset?.toLowerCase() === "utf-8" ||
        node.attribs.name === "viewport"
      )
    )
      throw new Error("Only charset and viewport meta tags are supported");
    if (
      node.name === "link" &&
      (node.attribs.rel !== "stylesheet" ||
        !node.attribs.href?.endsWith(".css"))
    )
      throw new Error("Only local stylesheet links are supported");
    if (node.name === "img" && (!node.attribs.src || !node.attribs.alt))
      throw new Error("Images require local src and nonempty alt");
    if (node.name === "style")
      validateCss(
        node.children
          .filter(isText)
          .map((n) => n.data)
          .join(""),
        "document.html",
        files,
      );
    if (node.name === "title")
      title = node.children
        .filter(isText)
        .map((n) => n.data)
        .join("");
    const id = node.attribs["data-dstar-id"];
    if (id !== undefined) {
      if (!ID.test(id) || Object.hasOwn(elements, id))
        throw new Error(`Invalid or duplicate stable ID: ${id}`);
      const text = elementText(node);
      indexedTextSize += Buffer.byteLength(text);
      if (indexedTextSize > MAX_TOTAL)
        throw new Error("Indexed text limit exceeded");
      elements[id] = {
        id,
        tag: node.name,
        parent,
        order: elementCount++,
        text,
        attributes: { ...node.attribs },
      };
    }
    const body = inBody || node.name === "body",
      hide = isHidden || hidden(node);
    if (body && !hide && node.name === "img" && !id)
      throw new Error("Images require a stable data-dstar-id");
    for (const child of node.children)
      visit(child, id ?? parent, depth + 1, body, hide);
  };
  for (const child of doc.children) visit(child, null, 0, false, false);
  if (roots !== 1 || bodies !== 1 || !Object.keys(elements).length)
    throw new Error("HTML requires one html/body and stable content IDs");
  return { elements, title };
}

export function resolveTarget(index: HtmlIndex, target: Target): Resolution {
  const resolveRange = (
    elementId: string,
    s: Extract<Target["selector"], { type: "text-range" }>,
  ): Resolution => {
    const element = Object.hasOwn(index.elements, elementId)
      ? index.elements[elementId]
      : undefined;
    if (!element) return { status: "orphaned" };
    const text = [...element.text],
      length = [...s.exact].length;
    if (text.slice(s.start, s.end).join("") === s.exact)
      return { status: "exact", start: s.start, end: s.end };
    if (!length) return { status: "orphaned" };
    const prefix = [...(s.prefix ?? "")];
    const pattern = [...prefix, ...s.exact, ...(s.suffix ?? "")];
    const fallback = new Uint32Array(pattern.length);
    for (let i = 1, matched = 0; i < pattern.length; i++) {
      while (matched && pattern[i] !== pattern[matched])
        matched = fallback[matched - 1]!;
      if (pattern[i] === pattern[matched]) matched++;
      fallback[i] = matched;
    }
    let found: number | undefined;
    for (let i = 0, matched = 0; i < text.length; i++) {
      while (matched && text[i] !== pattern[matched])
        matched = fallback[matched - 1]!;
      if (text[i] === pattern[matched]) matched++;
      if (matched !== pattern.length) continue;
      if (found !== undefined) return { status: "ambiguous" };
      found = i + 1 - pattern.length + prefix.length;
      matched = fallback[matched - 1]!;
    }
    return found === undefined
      ? { status: "orphaned" }
      : { status: "recovered", start: found, end: found + length };
  };
  const element = Object.hasOwn(index.elements, target.element)
    ? index.elements[target.element]
    : undefined;
  if (!element) return { status: "orphaned" };
  const s = target.selector;
  if (s.type === "element") return { status: "exact" };
  if (s.type === "text-range") return resolveRange(target.element, s);
  const ranges = s.ranges.map((part) => ({
    element: part.element,
    ...resolveRange(part.element, { type: "text-range", ...part }),
  }));
  const statuses = ranges.map((part) => part.status);
  return {
    status: statuses.includes("orphaned")
      ? "orphaned"
      : statuses.includes("ambiguous")
        ? "ambiguous"
        : statuses.includes("recovered")
          ? "recovered"
          : "exact",
    ranges,
  };
}
const validTextRange = (
  s: Omit<Extract<Target["selector"], { type: "text-range" }>, "type">,
) =>
  s.unit === "unicode-code-point" &&
  Number.isSafeInteger(s.start) &&
  Number.isSafeInteger(s.end) &&
  s.start >= 0 &&
  s.end > s.start &&
  typeof s.exact === "string" &&
  [...s.exact].length === s.end - s.start &&
  (s.prefix === undefined || typeof s.prefix === "string") &&
  (s.suffix === undefined || typeof s.suffix === "string");
export function validateTarget(index: HtmlIndex, target: Target): void {
  if (
    !target ||
    !/^sha256:[a-f0-9]{64}$/.test(target.revision) ||
    !ID.test(target.element) ||
    !target.selector
  )
    throw new Error("Invalid comment target");
  const s = target.selector;
  if (s.type === "text-range") {
    if (!validTextRange(s)) throw new Error("Invalid Unicode text selector");
  } else if (s.type === "text-ranges") {
    if (
      !Array.isArray(s.ranges) ||
      s.ranges.length < 2 ||
      s.ranges.length > 64 ||
      s.ranges[0]?.element !== target.element ||
      s.ranges.some(
        (part) => !ID.test(part.element) || !validTextRange(part),
      ) ||
      new Set(s.ranges.map((part) => part.element)).size !== s.ranges.length ||
      s.ranges.some(
        (part, position) =>
          position > 0 &&
          (index.elements[s.ranges[position - 1]!.element]?.order ??
            Infinity) >= (index.elements[part.element]?.order ?? -1),
      )
    )
      throw new Error("Invalid multi-element text selector");
  } else if (s.type !== "element") throw new Error("Unsupported selector");
  if (resolveTarget(index, target).status !== "exact")
    throw new Error(
      "Comment target does not exactly match the viewed revision",
    );
}

export function reviewDiff(
  before: Files,
  after: Files,
  comments: Comment[],
): ReviewDiff {
  const left: HtmlIndex["elements"] = before.size
      ? validateHtml(before).elements
      : Object.create(null),
    right = validateHtml(after).elements;
  const elements: ReviewDiff["elements"] = [];
  let elementChangeCount = 0;
  const preview = (e: ElementInfo | null) =>
    e
      ? {
          tag: e.tag,
          parent: e.parent,
          order: e.order,
          text: [...e.text].slice(0, 160).join(""),
          textLength: [...e.text].length,
          textHash: digest(e.text),
        }
      : null;
  for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const a = left[id] ?? null,
      b = right[id] ?? null;
    const changes: string[] = [];
    if (!a) changes.push("inserted");
    else if (!b) changes.push("removed");
    else {
      if (a.text !== b.text) changes.push("text");
      if (a.tag !== b.tag) changes.push("tag");
      if (a.parent !== b.parent || a.order !== b.order)
        changes.push("position");
      if (JSON.stringify(a.attributes) !== JSON.stringify(b.attributes))
        changes.push("attributes/style");
    }
    if (changes.length) {
      elementChangeCount++;
      if (elements.length < 200)
        elements.push({ id, changes, before: preview(a), after: preview(b) });
    }
  }
  const paths = new Set([...before.keys(), ...after.keys()]);
  const files: ReviewDiff["files"] = [];
  for (const path of [...paths].sort()) {
    const a = before.get(path),
      b = after.get(path);
    if (a && b && a.equals(b)) continue;
    files.push({
      path,
      kind: !a ? "added" : !b ? "removed" : "modified",
      beforeBytes: a?.length ?? 0,
      afterBytes: b?.length ?? 0,
    });
  }
  return {
    elements,
    elementChangeCount,
    files,
    rewriteRatio: Object.keys(left).length
      ? Object.keys(left).filter((id) => !Object.hasOwn(right, id)).length /
        Object.keys(left).length
      : 0,
    anchorRisks: comments
      .filter((c) => c.status === "open")
      .map((c) => ({
        comment: c.id,
        status: resolveTarget({ elements: right, title: "" }, c.target).status,
      }))
      .filter((c) => c.status !== "exact"),
  };
}
