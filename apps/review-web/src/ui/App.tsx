import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokenFromLocation, WorkspaceApi } from "../api.js";
import type {
  ProjectionView,
  HistoricalDocumentView,
  SelectionCapture,
  SessionView,
  WorkspaceState,
} from "../types.js";
import { Inspector } from "./Inspector.js";
import { ProposalReview } from "./ProposalReview.js";
import { ReaderPanel } from "./ReaderPanel.js";
import { ReviewRail } from "./ReviewRail.js";

type Surface = "review" | "proposals" | "inspector";

export function App() {
  const api = useMemo(() => new WorkspaceApi(tokenFromLocation()), []);
  const [session, setSession] = useState<SessionView>();
  const [state, setState] = useState<WorkspaceState>();
  const [surface, setSurface] = useState<Surface>("review");
  const [capture, setCapture] = useState<SelectionCapture>();
  const [projection, setProjection] = useState<ProjectionView>();
  const projectionId = useRef<string | undefined>(undefined);
  const [historical, setHistorical] = useState<HistoricalDocumentView>();
  const historicalId = useRef<string | undefined>(undefined);
  const mutationInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const next = await api.state();
      setState(next);
      setCapture(undefined);
      if (projectionId.current) {
        const current = next.snapshot.projections.find(
          (candidate) => candidate.id === projectionId.current,
        );
        if (current) setProjection(await api.projection(current.id));
        else {
          projectionId.current = undefined;
          setProjection(undefined);
        }
      }
      if (historicalId.current)
        setHistorical(await api.historicalDocument(historicalId.current));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Workspace refresh failed",
      );
    }
  }, [api]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    void api
      .initialize()
      .then((value) => {
        if (!current) return;
        setSession(value);
        return reload();
      })
      .then(() => {
        if (current)
          api.watchInvalidations(controller.signal, () => void reload());
      })
      .catch((loadError: unknown) => {
        if (current)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Session initialization failed",
          );
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [api, reload]);

  const mutation = useCallback(
    async (path: string, input: Readonly<Record<string, unknown>>) => {
      if (!state || mutationInFlight.current) return false;
      mutationInFlight.current = true;
      setBusy(true);
      setError("");
      try {
        await api.mutate(path, state.snapshot.snapshotId, input);
        await reload();
        return true;
      } catch (mutationError) {
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : "Review command failed",
        );
        return false;
      } finally {
        mutationInFlight.current = false;
        setBusy(false);
      }
    },
    [api, reload, state],
  );

  const selectProjection = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const selected = await api.projection(id);
        projectionId.current = id;
        historicalId.current = undefined;
        setHistorical(undefined);
        setProjection(selected);
        setCapture(undefined);
        setSurface("review");
      } catch (projectionError) {
        setError(
          projectionError instanceof Error
            ? projectionError.message
            : "Projection could not be opened",
        );
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  if (!api.token)
    return (
      <main className="fatal-state">
        <p className="eyebrow">Session unavailable</p>
        <h1>DSTAR needs a launch token</h1>
        <p>
          Start this review surface with{" "}
          <code>dstar serve &lt;package&gt;</code>.
        </p>
      </main>
    );
  if (!state || !session)
    return (
      <main className="fatal-state">
        <p className="eyebrow">Opening verified snapshot</p>
        <h1>{error || "Loading DSTAR review…"}</h1>
      </main>
    );

  const freshSelection =
    !historical &&
    (capture?.target.source === "document" ||
      (projection?.fresh !== false &&
        projection?.projection.reviewable !== false));

  return (
    <div className="app-shell" aria-busy={busy}>
      <header className="topbar">
        <div className="brand-mark">D*</div>
        <div className="document-title">
          <p className="eyebrow">Portable documents · Human decisions</p>
          <h1>{state.snapshot.manifest.title}</h1>
        </div>
        <div className="identity">
          <span>Human session</span>
          <strong>{session.human.id}</strong>
        </div>
      </header>
      <nav className="surface-tabs" aria-label="Review surfaces">
        {(["review", "proposals", "inspector"] as const).map((item) => (
          <button
            aria-current={surface === item ? "page" : undefined}
            className={surface === item ? "active" : ""}
            key={item}
            onClick={() => setSurface(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </nav>
      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}
      {busy ? (
        <div className="progress" role="status">
          Applying verified command…
        </div>
      ) : null}
      <main>
        {surface === "review" ? (
          <div className="review-layout">
            <ReaderPanel
              document={state.document}
              {...(projection ? { projection } : {})}
              {...(historical ? { historical } : {})}
              onCapture={setCapture}
              onError={setError}
            />
            {historical ? (
              <aside className="review-rail historical-notice">
                <p className="eyebrow">Inspection only</p>
                <h2>Historical version</h2>
                <p>
                  Comments, proposal decisions, and projection regeneration
                  apply only to the current package snapshot.
                </p>
                <button
                  className="button button-primary"
                  onClick={() => {
                    historicalId.current = undefined;
                    setHistorical(undefined);
                  }}
                  type="button"
                >
                  Return to current document
                </button>
              </aside>
            ) : (
              <ReviewRail
                annotations={state.annotations}
                {...(capture ? { capture } : {})}
                freshSelection={freshSelection}
                onComment={(input) => mutation("/annotations", input)}
                onReply={(id, body) =>
                  mutation(`/annotations/${id}/replies`, { body })
                }
                onResolve={(id) => mutation(`/annotations/${id}/resolve`, {})}
                onAssign={(annotationId, assigneeId) =>
                  mutation(`/annotations/${annotationId}/assign`, {
                    assigneeId,
                  })
                }
              />
            )}
          </div>
        ) : null}
        {surface === "proposals" ? (
          <ProposalReview
            api={api}
            changes={state.changes}
            onDecision={async (id, decision, simulation) => {
              if (decision === "accept") {
                const revision = String(simulation?.resultRevision ?? "");
                if (
                  !revision ||
                  !window.confirm(
                    `Accept proposal ${id} by ${state.changes.find((change) => change.id === id)?.author.id ?? "unknown"} as human ${session.human.id}?\n\nAffected objects: ${JSON.stringify(simulation?.semanticDiff ?? {})}\n\nResult revision: ${revision}`,
                  )
                )
                  return;
                await mutation(`/changes/${id}/accept`, {
                  expectedResultRevision: revision,
                });
                return;
              }
              const reason = window.prompt(
                `${decision} ${id}: optional reason`,
              );
              if (reason === null) return;
              await mutation(`/changes/${id}/${decision}`, {
                ...(reason ? { reason } : {}),
              });
            }}
          />
        ) : null}
        {surface === "inspector" ? (
          <Inspector
            snapshot={state.snapshot}
            versions={state.versions}
            sources={state.sources.sources}
            {...(projection
              ? { activeProjectionId: projection.projection.id }
              : {})}
            onCanonical={() => {
              projectionId.current = undefined;
              historicalId.current = undefined;
              setProjection(undefined);
              setHistorical(undefined);
              setCapture(undefined);
              setSurface("review");
            }}
            onProjection={(id) => void selectProjection(id)}
            onHistory={(id) => {
              setBusy(true);
              void api
                .historicalDocument(id)
                .then((view) => {
                  historicalId.current = id;
                  projectionId.current = undefined;
                  setProjection(undefined);
                  setHistorical(view);
                  setCapture(undefined);
                  setSurface("review");
                })
                .catch((historyError: unknown) =>
                  setError(
                    historyError instanceof Error
                      ? historyError.message
                      : "Historical materialization failed",
                  ),
                )
                .finally(() => setBusy(false));
            }}
            onRegenerate={(id) => mutation(`/projections/${id}/regenerate`, {})}
          />
        ) : null}
      </main>
    </div>
  );
}
