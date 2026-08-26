import type { DstarProjection } from "@dstar/core";

import {
  captureCanonicalSelection,
  captureProjectionSelection,
} from "./selection.js";
import type { DocumentView } from "./types.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const canonical = document.createElement("p");
canonical.innerHTML =
  '<span data-dstar-text-run="run_1">Read 😀</span><span data-dstar-text-run="run_2"><strong>DSTAR</strong></span>';
document.body.append(canonical);
const canonicalTexts = canonical.querySelectorAll("span");
const canonicalRange = document.createRange();
canonicalRange.setStart(canonicalTexts[0]!.firstChild!, 5);
canonicalRange.setEnd(
  canonicalTexts[1]!.querySelector("strong")!.firstChild!,
  5,
);
const canonicalView: DocumentView = {
  documentRevision: `sha256:${"a".repeat(64)}`,
  html: "",
  nodeOrder: ["node_root", "node_unicode"],
  nodeTexts: { node_unicode: "Read 😀DSTAR" },
  textRuns: [
    {
      id: "run_1",
      nodeId: "node_unicode",
      start: 0,
      end: 6,
      canonical: true,
      text: "Read 😀",
    },
    {
      id: "run_2",
      nodeId: "node_unicode",
      start: 6,
      end: 11,
      canonical: true,
      text: "DSTAR",
    },
  ],
  diagnostics: [],
};
const canonicalCapture = captureCanonicalSelection(
  canonicalRange,
  canonicalView,
);
assert(canonicalCapture.exact === "😀DSTAR", "canonical exact text mismatch");
assert(
  canonicalCapture.target.selector.type === "NodeSelector",
  "canonical selector type mismatch",
);
const position = canonicalCapture.target.selector.refinedBy?.find(
  (selector) => selector.type === "TextPositionSelector",
);
assert(
  position?.type === "TextPositionSelector" &&
    position.start === 5 &&
    position.end === 11,
  "canonical Unicode code-point offsets mismatch",
);

const projectionRoot = document.createElement("p");
projectionRoot.innerHTML =
  '<span data-dstar-segment="segment_1">View 😀</span><span data-dstar-segment="segment_2"><em>mapped</em></span>';
document.body.append(projectionRoot);
const projectionTexts = projectionRoot.querySelectorAll("span");
const projectionRange = document.createRange();
projectionRange.setStart(projectionTexts[0]!.firstChild!, 5);
projectionRange.setEnd(projectionTexts[1]!.querySelector("em")!.firstChild!, 6);
const projection: DstarProjection = {
  id: "projection_browser_check",
  role: "review",
  path: "projections/check.html",
  mediaType: "text/html",
  revision: `sha256:${"b".repeat(64)}`,
  generatedFromRevision: canonicalView.documentRevision,
  renderer: { name: "browser-check", version: "0.1.0" },
  reviewable: true,
  segments: [
    {
      id: "segment_1",
      selectors: [{ type: "FragmentSelector", value: "segment_1" }],
      derivedFrom: [
        {
          relation: "exact",
          selector: { type: "NodeSelector", node: "node_unicode" },
        },
      ],
    },
    {
      id: "segment_2",
      selectors: [{ type: "FragmentSelector", value: "segment_2" }],
      derivedFrom: [
        {
          relation: "summarizes",
          selector: { type: "NodeSelector", node: "node_summary" },
        },
      ],
    },
  ],
};
const projectionCapture = captureProjectionSelection(
  projectionRange,
  projection,
);
assert(
  projectionCapture.exact === "😀mapped",
  "projection exact text mismatch",
);
assert(
  projectionCapture.target.selector.type === "SegmentRangeSelector",
  "projection selector type mismatch",
);
assert(
  projectionCapture.target.selector.start.offset === 5 &&
    projectionCapture.target.selector.end.offset === 6,
  "projection Unicode code-point offsets mismatch",
);
assert(
  projectionCapture.canonicalTargets?.length === 2,
  "projection canonical mappings were not preserved",
);

document.querySelector("#result")!.textContent = JSON.stringify(
  { status: "PASS", canonicalCapture, projectionCapture },
  null,
  2,
);
