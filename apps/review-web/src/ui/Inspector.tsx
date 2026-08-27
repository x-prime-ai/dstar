import type { CanonicalVersionSummary } from "@dstar/core";
import type { SnapshotView } from "../types.js";

export function Inspector({
  snapshot,
  versions,
  sources,
  activeProjectionId,
  onProjection,
  onCanonical,
  onRegenerate,
  onHistory,
}: {
  readonly snapshot: SnapshotView;
  readonly versions: readonly CanonicalVersionSummary[];
  readonly sources: readonly unknown[];
  readonly activeProjectionId?: string;
  readonly onProjection: (id: string) => void;
  readonly onCanonical: () => void;
  readonly onRegenerate: (id: string) => Promise<boolean>;
  readonly onHistory: (id: string) => void;
}) {
  return (
    <section className="panel inspector" aria-labelledby="inspector-heading">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Package truth</p>
          <h2 id="inspector-heading">Document inspector</h2>
        </div>
      </header>
      <dl className="facts">
        <div>
          <dt>Document</dt>
          <dd>{snapshot.manifest.id}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{snapshot.manifest.revision}</dd>
        </div>
        <div>
          <dt>Head</dt>
          <dd>{snapshot.manifest.headChange}</dd>
        </div>
        <div>
          <dt>Profiles</dt>
          <dd>{snapshot.manifest.profiles.join(", ")}</dd>
        </div>
      </dl>
      <h3>Views</h3>
      <button
        className={!activeProjectionId ? "view-button active" : "view-button"}
        onClick={onCanonical}
        type="button"
      >
        Canonical · current
      </button>
      {snapshot.projections.map((projection) => (
        <div className="projection-row" key={projection.id}>
          <button
            className={
              activeProjectionId === projection.id
                ? "view-button active"
                : "view-button"
            }
            onClick={() => onProjection(projection.id)}
            type="button"
          >
            {projection.id} · {projection.fresh ? "current" : "stale"}
          </button>
          <button
            className="button button-quiet"
            onClick={() => void onRegenerate(projection.id)}
            type="button"
          >
            Regenerate
          </button>
        </div>
      ))}
      <h3>History</h3>
      <div className="history-list">
        {versions.map((version) => (
          <button
            className="view-button"
            key={version.changeId}
            onClick={() => onHistory(version.changeId)}
            type="button"
          >
            <strong>{version.changeId}</strong>
            <span>
              {version.kind} · {version.resultRevision}
            </span>
            <span>Author {version.authorId}</span>
            <span>
              Decided by {version.humanDecisionActorId} · {version.decidedAt}
            </span>
          </button>
        ))}
      </div>
      <h3>Sources</h3>
      <pre>{JSON.stringify(sources, null, 2)}</pre>
      <h3>Diagnostics</h3>
      <pre>{JSON.stringify(snapshot.diagnostics, null, 2)}</pre>
    </section>
  );
}
