import { DocumentIndex, nodeTextStream } from "./indexes.js";
import type {
  DstarDocument,
  DstarNodeRangeSelector,
  DstarNodeSelector,
  DstarTarget,
} from "./protocol.js";

export function unicodeCodePoints(value: string): readonly string[] {
  return Object.freeze([...value]);
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function codePointSlice(
  value: string,
  start: number,
  end?: number,
): string {
  return [...value].slice(start, end).join("");
}

export function utf16OffsetToCodePoint(
  value: string,
  utf16Offset: number,
): number {
  if (
    !Number.isInteger(utf16Offset) ||
    utf16Offset < 0 ||
    utf16Offset > value.length
  ) {
    throw new RangeError("UTF-16 offset is outside the string");
  }
  const before = value.slice(0, utf16Offset);
  const last = before.charCodeAt(before.length - 1);
  const next = value.charCodeAt(utf16Offset);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    throw new RangeError("UTF-16 offset splits a surrogate pair");
  }
  return [...before].length;
}

export function codePointOffsetToUtf16(
  value: string,
  codePointOffset: number,
): number {
  const points = [...value];
  if (
    !Number.isInteger(codePointOffset) ||
    codePointOffset < 0 ||
    codePointOffset > points.length
  ) {
    throw new RangeError("Code-point offset is outside the string");
  }
  return points.slice(0, codePointOffset).join("").length;
}

export function canonicalRangeText(
  index: DocumentIndex,
  selector: DstarNodeRangeSelector,
): string | undefined {
  const startOrder = index.orderById.get(selector.start.node);
  const endOrder = index.orderById.get(selector.end.node);
  if (
    startOrder === undefined ||
    endOrder === undefined ||
    startOrder > endOrder
  )
    return undefined;
  const startNode = index.get(selector.start.node);
  const endNode = index.get(selector.end.node);
  if (!startNode || !endNode) return undefined;
  const startText = nodeTextStream(startNode);
  const endText = nodeTextStream(endNode);
  if (
    selector.start.offset < 0 ||
    selector.end.offset < 0 ||
    selector.start.offset > codePointLength(startText) ||
    selector.end.offset > codePointLength(endText) ||
    (startOrder === endOrder && selector.start.offset > selector.end.offset)
  ) {
    return undefined;
  }
  if (startOrder === endOrder) {
    return codePointSlice(
      startText,
      selector.start.offset,
      selector.end.offset,
    );
  }
  const components: string[] = [];
  const startSuffix = codePointSlice(startText, selector.start.offset);
  if (startSuffix) components.push(startSuffix);
  for (let order = startOrder + 1; order < endOrder; order += 1) {
    const nodeId = index.readingOrder[order];
    const node = nodeId ? index.get(nodeId) : undefined;
    const text = node ? nodeTextStream(node) : "";
    if (text) components.push(text);
  }
  const endPrefix = codePointSlice(endText, 0, selector.end.offset);
  if (endPrefix) components.push(endPrefix);
  return components.join("\n");
}

export type TargetResolution =
  | {
      readonly state: "exact";
      readonly selector: DstarNodeSelector | DstarNodeRangeSelector;
    }
  | {
      readonly state: "recovered";
      readonly selector: DstarNodeSelector;
      readonly method: "quote-context";
    }
  | {
      readonly state: "ambiguous";
      readonly candidates: readonly DstarNodeSelector[];
    }
  | { readonly state: "orphaned" }
  | { readonly state: "missing-source" };

function refinedPosition(selector: DstarNodeSelector) {
  return selector.refinedBy?.find(
    (refinement) => refinement.type === "TextPositionSelector",
  );
}

function refinedQuote(selector: DstarNodeSelector) {
  return selector.refinedBy?.find(
    (refinement) => refinement.type === "TextQuoteSelector",
  );
}

function findQuoteCandidates(
  nodeId: string,
  text: string,
  exact: string,
  prefix?: string,
  suffix?: string,
): DstarNodeSelector[] {
  const haystack = [...text];
  const needle = [...exact];
  const candidates: DstarNodeSelector[] = [];
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (!needle.every((point, offset) => point === haystack[start + offset]))
      continue;
    const end = start + needle.length;
    if (
      prefix !== undefined &&
      !codePointSlice(text, 0, start).endsWith(prefix)
    )
      continue;
    if (suffix !== undefined && !codePointSlice(text, end).startsWith(suffix))
      continue;
    candidates.push({
      type: "NodeSelector",
      node: nodeId,
      refinedBy: [
        {
          type: "TextPositionSelector",
          start,
          end,
          unit: "unicode-code-point",
        },
        {
          type: "TextQuoteSelector",
          exact,
          ...(prefix ? { prefix } : {}),
          ...(suffix ? { suffix } : {}),
        },
      ],
    });
  }
  return candidates;
}

export function resolveNodeSelector(
  index: DocumentIndex,
  selector: DstarNodeSelector,
): TargetResolution {
  const node = index.get(selector.node);
  if (!node) return { state: "orphaned" };
  if (!selector.refinedBy) return { state: "exact", selector };
  const position = refinedPosition(selector);
  const quote = refinedQuote(selector);
  const text = nodeTextStream(node);

  if (
    position &&
    position.start >= 0 &&
    position.start <= position.end &&
    position.end <= codePointLength(text) &&
    (!quote ||
      codePointSlice(text, position.start, position.end) === quote.exact)
  ) {
    return { state: "exact", selector };
  }
  if (!quote) return { state: "orphaned" };
  const candidates = findQuoteCandidates(
    selector.node,
    text,
    quote.exact,
    quote.prefix,
    quote.suffix,
  );
  if (candidates.length === 1) {
    return {
      state: "recovered",
      selector: candidates[0]!,
      method: "quote-context",
    };
  }
  if (candidates.length > 1)
    return { state: "ambiguous", candidates: Object.freeze(candidates) };
  return { state: "orphaned" };
}

export function resolveCanonicalTarget(
  document: DstarDocument,
  target: DstarTarget,
): TargetResolution {
  if (target.source !== "document") return { state: "missing-source" };
  const index = new DocumentIndex(document);
  if (target.selector.type === "NodeSelector")
    return resolveNodeSelector(index, target.selector);
  if (target.selector.type === "NodeRangeSelector") {
    const quote = canonicalRangeText(index, target.selector);
    if (quote === undefined) return { state: "orphaned" };
    return quote === target.selector.exact
      ? { state: "exact", selector: target.selector }
      : { state: "orphaned" };
  }
  return { state: "missing-source" };
}
