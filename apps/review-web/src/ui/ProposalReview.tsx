import { useEffect, useState } from "react";
import type { DstarChange } from "@dstar/core";
import type { WorkspaceApi } from "../api.js";

interface SimulationView extends Record<string, unknown> {
  readonly applicability?: string;
  readonly resultRevision?: string;
  readonly semanticDiff?: unknown;
  readonly beforeHtml?: string;
  readonly afterHtml?: string;
}

export function ProposalReview({
  api,
  changes,
  onDecision,
}: {
  readonly api: WorkspaceApi;
  readonly changes: readonly DstarChange[];
  readonly onDecision: (
    id: string,
    decision: "accept" | "reject" | "supersede",
    simulation?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const proposals = changes.filter((change) => change.kind === "update");
  const [selectedId, setSelectedId] = useState(proposals[0]?.id ?? "");
  const [simulation, setSimulation] = useState<SimulationView>();
  const [simulationError, setSimulationError] = useState("");
  const selected = proposals.find((change) => change.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    setSimulation(undefined);
    setSimulationError("");
    void api
      .simulation(selectedId)
      .then((value) => {
        if (current) setSimulation(value);
      })
      .catch((error: unknown) => {
        if (current)
          setSimulationError(
            error instanceof Error ? error.message : "Simulation failed",
          );
      });
    return () => {
      current = false;
    };
  }, [api, selectedId]);

  return (
    <section
      className="panel proposal-panel"
      aria-labelledby="proposal-heading"
    >
      <header className="section-heading">
        <div>
          <p className="eyebrow">Deterministic simulation only</p>
          <h2 id="proposal-heading">Proposal review</h2>
        </div>
      </header>
      <div className="proposal-layout">
        <nav className="proposal-list" aria-label="Change proposals">
          {proposals.map((change) => (
            <button
              className={
                change.id === selectedId
                  ? "proposal-link active"
                  : "proposal-link"
              }
              key={change.id}
              onClick={() => setSelectedId(change.id)}
              type="button"
            >
              <strong>{change.id}</strong>
              <span>
                {change.status} · {change.author.id}
              </span>
            </button>
          ))}
        </nav>
        {selected ? (
          <article className="proposal-detail">
            <div className="thread-meta">
              <span className="status">
                {String(simulation?.applicability ?? "loading")}
              </span>
              <span>Pending review</span>
            </div>
            <h3>{selected.id}</h3>
            {simulationError ? (
              <p className="error-banner" role="alert">
                {simulationError}
              </p>
            ) : null}
            <dl className="facts">
              <div>
                <dt>Author</dt>
                <dd>{selected.author.id}</dd>
              </div>
              <div>
                <dt>Base</dt>
                <dd>{selected.baseRevision}</dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>{String(simulation?.resultRevision ?? "Unavailable")}</dd>
              </div>
            </dl>
            <h4>Ordered operations</h4>
            <ol className="operation-list">
              {selected.operations.map((operation) => (
                <li key={operation.id}>
                  <code>{operation.op}</code> · {operation.id}
                </li>
              ))}
            </ol>
            <h4>Semantic diff</h4>
            <pre>{JSON.stringify(simulation?.semanticDiff ?? {}, null, 2)}</pre>
            <h4>Verified canonical before / simulated after</h4>
            <div className="comparison-grid">
              <div>
                <p className="eyebrow">Before · current canonical</p>
                <iframe
                  className="comparison-frame"
                  sandbox="allow-same-origin"
                  srcDoc={simulation?.beforeHtml ?? ""}
                  title={`Canonical document before ${selected.id}`}
                />
              </div>
              <div>
                <p className="eyebrow">After · deterministic simulation</p>
                {simulation?.afterHtml ? (
                  <iframe
                    className="comparison-frame"
                    sandbox="allow-same-origin"
                    srcDoc={simulation.afterHtml}
                    title={`Simulated canonical document after ${selected.id}`}
                  />
                ) : (
                  <p className="empty-state">No valid after-document.</p>
                )}
              </div>
            </div>
            <div className="decision-bar">
              <button
                className="button button-primary"
                disabled={
                  selected.status !== "proposed" ||
                  simulation?.applicability !== "applicable"
                }
                onClick={() =>
                  void onDecision(selected.id, "accept", simulation)
                }
                type="button"
              >
                Accept proposal
              </button>
              <button
                className="button button-danger"
                disabled={selected.status !== "proposed"}
                onClick={() =>
                  void onDecision(selected.id, "reject", simulation)
                }
                type="button"
              >
                Reject
              </button>
              <button
                className="button button-quiet"
                disabled={selected.status !== "proposed"}
                onClick={() =>
                  void onDecision(selected.id, "supersede", simulation)
                }
                type="button"
              >
                Supersede
              </button>
            </div>
          </article>
        ) : (
          <p className="empty-state">No update proposals yet.</p>
        )}
      </div>
    </section>
  );
}
