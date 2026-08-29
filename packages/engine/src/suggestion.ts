import { parse, serializeOuter } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import {
  isTag,
  isText,
  type AnyNode,
  type Element,
  type Text,
} from "domhandler";
import { revision } from "./delta.js";
import { utf8, validateHtml, validateTarget } from "./html.js";
import type { Files, Target, TextRangeSelector } from "./types.js";

const hidden = (element: Element): boolean =>
  "hidden" in element.attribs ||
  element.attribs["aria-hidden"] === "true" ||
  ["head", "style", "script"].includes(element.name);

function findElement(node: AnyNode, id: string): Element | null {
  if (isTag(node) && node.attribs["data-dstar-id"] === id) return node;
  if (!isTag(node) && !("children" in node)) return null;
  for (const child of node.children) {
    const match = findElement(child, id);
    if (match) return match;
  }
  return null;
}

function visibleTextNodes(element: Element, ancestorHidden = false): Text[] {
  const nodes: Text[] = [],
    isHidden = ancestorHidden || hidden(element);
  if (isHidden) return nodes;
  for (const child of element.children) {
    if (isText(child)) nodes.push(child);
    else if (isTag(child)) nodes.push(...visibleTextNodes(child, isHidden));
  }
  return nodes;
}

function replaceRange(
  element: Element,
  selector: TextRangeSelector,
  replacement: string,
): void {
  let offset = 0,
    replaced = false;
  for (const node of visibleTextNodes(element)) {
    const points = [...node.data],
      start = offset,
      end = start + points.length,
      from = Math.max(selector.start, start),
      to = Math.min(selector.end, end);
    offset = end;
    if (from >= to) continue;
    node.data =
      points.slice(0, from - start).join("") +
      (replaced ? "" : replacement) +
      points.slice(to - start).join("");
    replaced = true;
  }
  if (!replaced) throw new Error("Suggestion selection is empty");
}

/** Replace one exact text selection while preserving the rest of the package. */
export function replaceTargetText(
  files: Files,
  target: Target,
  replacement: string,
): Files {
  if (
    typeof replacement !== "string" ||
    !replacement.trim() ||
    replacement.length > 20000
  )
    throw new Error("Suggested replacement is required");
  if (target.selector.type !== "text-range")
    throw new Error(
      "Manual suggestions require a text selection within one element",
    );
  if (revision(files) !== target.revision)
    throw new Error("Suggestion target does not match the source revision");
  const index = validateHtml(files);
  validateTarget(index, target);
  const html = utf8(files.get("document.html")!),
    document = parse(html, {
      treeAdapter: adapter,
      sourceCodeLocationInfo: true,
    }),
    element = findElement(document, target.element);
  if (!element) throw new Error("Suggestion element is unavailable");
  const location = adapter.getNodeSourceCodeLocation(element);
  if (!location?.startTag || !location.endTag)
    throw new Error("Suggestion element has no editable source range");
  replaceRange(element, target.selector, replacement);
  const next = new Map(files);
  next.set(
    "document.html",
    Buffer.from(
      html.slice(0, location.startOffset) +
        serializeOuter(element, { treeAdapter: adapter }) +
        html.slice(location.endOffset),
    ),
  );
  validateHtml(next);
  return next;
}
