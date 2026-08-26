import {
  codePointSlice,
  utf16OffsetToCodePoint,
  type DstarAnnotation,
  type DstarProjection,
  type DstarTarget,
} from "@dstar/core";
import type { DocumentView, SelectionCapture, TextRunView } from "./types.js";

const CONTEXT_LENGTH = 32;

function containingElement(
  node: Node,
  attribute: string,
): HTMLElement | undefined {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return element?.closest<HTMLElement>(`[${attribute}]`) ?? undefined;
}

function utf16OffsetWithin(
  owner: HTMLElement,
  container: Node,
  offset: number,
): number {
  const range = owner.ownerDocument.createRange();
  range.selectNodeContents(owner);
  range.setEnd(container, offset);
  return range.toString().length;
}

function runEndpoint(
  container: Node,
  offset: number,
  byId: ReadonlyMap<string, TextRunView>,
): { run: TextRunView; offset: number } {
  const owner = containingElement(container, "data-dstar-text-run");
  const runId = owner?.dataset.dstarTextRun;
  const run = runId ? byId.get(runId) : undefined;
  if (!owner || !run)
    throw new Error("Selection boundary is outside canonical text");
  const utf16 = utf16OffsetWithin(owner, container, offset);
  if (owner.textContent !== run.text)
    throw new Error(
      "Rendered canonical text no longer matches its registered run",
    );
  return { run, offset: run.start + utf16OffsetToCodePoint(run.text, utf16) };
}

function context(text: string, start: number, end: number) {
  return {
    prefix: codePointSlice(text, Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: codePointSlice(text, end, end + CONTEXT_LENGTH),
  };
}

export function captureCanonicalSelection(
  range: Range,
  view: DocumentView,
): SelectionCapture {
  if (range.collapsed)
    throw new Error("Select text before creating an inline comment");
  const runs = new Map(view.textRuns.map((run) => [run.id, run]));
  const start = runEndpoint(range.startContainer, range.startOffset, runs);
  const end = runEndpoint(range.endContainer, range.endOffset, runs);
  const startOrder = view.nodeOrder.indexOf(start.run.nodeId);
  const endOrder = view.nodeOrder.indexOf(end.run.nodeId);
  if (startOrder === -1 || endOrder === -1 || startOrder > endOrder)
    throw new Error("Selection order does not match canonical reading order");
  const visible = range.toString();
  let selector: DstarTarget["selector"];
  let exact: string;
  if (start.run.nodeId === end.run.nodeId) {
    const text = view.nodeTexts[start.run.nodeId] ?? "";
    exact = codePointSlice(text, start.offset, end.offset);
    if (!exact) throw new Error("Canonical selection is empty");
    const nearby = context(text, start.offset, end.offset);
    selector = {
      type: "NodeSelector",
      node: start.run.nodeId,
      refinedBy: [
        {
          type: "TextPositionSelector",
          start: start.offset,
          end: end.offset,
          unit: "unicode-code-point",
        },
        {
          type: "TextQuoteSelector",
          exact,
          ...(nearby.prefix ? { prefix: nearby.prefix } : {}),
          ...(nearby.suffix ? { suffix: nearby.suffix } : {}),
        },
      ],
    };
  } else {
    const parts: string[] = [];
    for (let order = startOrder; order <= endOrder; order += 1) {
      const nodeId = view.nodeOrder[order]!;
      const text = view.nodeTexts[nodeId] ?? "";
      const selected =
        order === startOrder
          ? codePointSlice(text, start.offset)
          : order === endOrder
            ? codePointSlice(text, 0, end.offset)
            : text;
      if (selected) parts.push(selected);
    }
    exact = parts.join("\n");
    if (!exact) throw new Error("Canonical selection is empty");
    selector = {
      type: "NodeRangeSelector",
      start: { node: start.run.nodeId, offset: start.offset },
      end: { node: end.run.nodeId, offset: end.offset },
      unit: "unicode-code-point",
      exact,
      ...(visible !== exact ? { viewExact: visible } : {}),
    };
  }
  return {
    target: { source: "document", revision: view.documentRevision, selector },
    exact,
    sourceLabel: "Canonical document",
  };
}

function segmentOffset(
  element: HTMLElement,
  container: Node,
  offset: number,
): number {
  return utf16OffsetToCodePoint(
    element.textContent ?? "",
    utf16OffsetWithin(element, container, offset),
  );
}

export function captureProjectionSelection(
  range: Range,
  projection: DstarProjection,
): SelectionCapture {
  if (range.collapsed)
    throw new Error("Select text before creating an inline comment");
  const startElement = containingElement(
    range.startContainer,
    "data-dstar-segment",
  );
  const endElement = containingElement(
    range.endContainer,
    "data-dstar-segment",
  );
  const startId = startElement?.dataset.dstarSegment;
  const endId = endElement?.dataset.dstarSegment;
  const segments = projection.segments ?? [];
  const startIndex = segments.findIndex((segment) => segment.id === startId);
  const endIndex = segments.findIndex((segment) => segment.id === endId);
  if (!startElement || !endElement || startIndex < 0 || endIndex < startIndex)
    throw new Error(
      "Selection contains unmapped or reversed projection content",
    );
  const exact = range.toString();
  if (!exact) throw new Error("Projection selection is empty");
  const start = segmentOffset(
    startElement,
    range.startContainer,
    range.startOffset,
  );
  const end = segmentOffset(endElement, range.endContainer, range.endOffset);
  const selector: DstarTarget["selector"] =
    startIndex === endIndex
      ? {
          type: "SegmentSelector",
          segment: startId!,
          refinedBy: [
            {
              type: "TextPositionSelector",
              start,
              end,
              unit: "unicode-code-point",
            },
            { type: "TextQuoteSelector", exact },
          ],
        }
      : {
          type: "SegmentRangeSelector",
          start: { segment: startId!, offset: start },
          end: { segment: endId!, offset: end },
          unit: "unicode-code-point",
          exact,
        };
  const canonicalTargets: Array<
    NonNullable<DstarAnnotation["canonicalTargets"]>[number]
  > = [];
  const seen = new Set<string>();
  for (const segment of segments.slice(startIndex, endIndex + 1)) {
    for (const mapping of segment.derivedFrom) {
      const target = {
        relation: mapping.relation,
        source: "document",
        revision: projection.generatedFromRevision,
        selector: mapping.selector,
      } as const;
      const key = JSON.stringify(target);
      if (!seen.has(key)) {
        seen.add(key);
        canonicalTargets.push(target);
      }
    }
  }
  if (canonicalTargets.length === 0)
    throw new Error("Projection selection has no canonical source mapping");
  return {
    target: { source: projection.id, revision: projection.revision, selector },
    canonicalTargets: canonicalTargets as NonNullable<
      DstarAnnotation["canonicalTargets"]
    >,
    exact,
    sourceLabel: `Projection ${projection.id}`,
  };
}

export function captureNodeObject(
  nodeId: string,
  revision: string,
): SelectionCapture {
  return {
    target: {
      source: "document",
      revision,
      selector: { type: "NodeSelector", node: nodeId },
    },
    exact: `Node ${nodeId}`,
    sourceLabel: "Canonical document object",
  };
}
