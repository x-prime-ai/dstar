import { useEffect, useRef } from "react";
import {
  captureCanonicalSelection,
  captureNodeObject,
  captureProjectionSelection,
} from "../selection.js";
import type {
  DocumentView,
  HistoricalDocumentView,
  ProjectionView,
  SelectionCapture,
} from "../types.js";

interface ReaderPanelProps {
  readonly document: DocumentView;
  readonly projection?: ProjectionView;
  readonly historical?: HistoricalDocumentView;
  readonly onCapture: (capture: SelectionCapture) => void;
  readonly onError: (message: string) => void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textProjectionDocument(projection: ProjectionView): string {
  const points = [...projection.content];
  let cursor = 0;
  let body = "";
  for (const segment of projection.projection.segments ?? []) {
    const position = segment.selectors.find(
      (selector) => selector.type === "TextPositionSelector",
    );
    if (position?.type !== "TextPositionSelector") continue;
    body += escapeHtml(points.slice(cursor, position.start).join(""));
    body += `<span data-dstar-segment="${escapeHtml(segment.id)}">${escapeHtml(
      points.slice(position.start, position.end).join(""),
    )}</span>`;
    cursor = position.end;
  }
  body += escapeHtml(points.slice(cursor).join(""));
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:2rem;font:16px/1.6 ui-monospace,monospace}pre{white-space:pre-wrap}</style></head><body><pre>${body}</pre></body></html>`;
}

export function ReaderPanel({
  document,
  projection,
  historical,
  onCapture,
  onError,
}: ReaderPanelProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const source = historical
    ? historical.html
    : projection
      ? projection.projection.mediaType === "text/html"
        ? projection.content
        : textProjectionDocument(projection)
      : document.html;

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    const capture = () => {
      const selection = iframe.contentWindow?.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
        return;
      try {
        if (historical)
          throw new Error("Historical canonical versions are inspection-only");
        const range = selection.getRangeAt(0);
        if (projection && !projection.projection.reviewable)
          throw new Error(
            "This stored projection failed reviewability validation",
          );
        onCapture(
          projection
            ? captureProjectionSelection(range, projection.projection)
            : captureCanonicalSelection(range, document),
        );
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "Selection could not be captured",
        );
      }
    };
    const attach = () =>
      iframe.contentDocument?.addEventListener("mouseup", capture);
    iframe.addEventListener("load", attach);
    attach();
    return () => {
      iframe.removeEventListener("load", attach);
      iframe.contentDocument?.removeEventListener("mouseup", capture);
    };
  }, [document, historical, onCapture, onError, projection, source]);

  return (
    <section className="reader-panel" aria-labelledby="reader-heading">
      <header className="section-heading">
        <div>
          <p className="eyebrow">
            {historical
              ? "Historical canonical content"
              : projection
                ? "Stored projection"
                : "Canonical source"}
          </p>
          <h2 id="reader-heading">
            {historical?.changeId ??
              projection?.projection.id ??
              "Current document"}
          </h2>
        </div>
        {historical ? (
          <span className="status status-warning">
            Historical · {historical.revision}
          </span>
        ) : projection &&
          (!projection.fresh || !projection.projection.reviewable) ? (
          <span className="status status-warning">
            {!projection.fresh ? "Stale" : "Mapping invalid"} · commenting
            disabled
          </span>
        ) : (
          <span className="status status-ok">Reviewable</span>
        )}
      </header>
      <p className="reader-instruction">
        {historical
          ? "This verified version is not the current document. All collaboration and decision controls are disabled."
          : "Select text in the document to open a portable comment. Canonical content is read-only."}
      </p>
      <iframe
        ref={frame}
        className="document-frame"
        sandbox="allow-same-origin"
        srcDoc={source}
        title={
          historical
            ? `Historical canonical version ${historical.changeId}`
            : projection
              ? `Projection ${projection.projection.id}`
              : "Canonical DSTAR document"
        }
      />
      {!projection && !historical ? (
        <div className="object-actions" aria-label="Comment on semantic object">
          {document.nodeOrder
            .filter((id) => id !== document.nodeOrder[0])
            .map((nodeId) => (
              <button
                className="button button-quiet"
                key={nodeId}
                onClick={() =>
                  onCapture(
                    captureNodeObject(nodeId, document.documentRevision),
                  )
                }
                type="button"
              >
                Comment on {nodeId}
              </button>
            ))}
        </div>
      ) : null}
    </section>
  );
}
