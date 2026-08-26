import type { DstarDelegation } from "@dstar/core";

export function AgentActivity({
  delegations,
  onCancel,
}: {
  readonly delegations: readonly DstarDelegation[];
  readonly onCancel: (id: string) => Promise<boolean>;
}) {
  return (
    <section className="panel" aria-labelledby="activity-heading">
      <header className="section-heading">
        <div>
          <p className="eyebrow">External host boundary</p>
          <h2 id="activity-heading">Agent activity</h2>
        </div>
      </header>
      <p className="muted">
        Delegations become visible to the assigned agent through the scoped
        DSTAR MCP server. This app does not run a model.
      </p>
      <div className="card-grid">
        {delegations.map((delegation) => (
          <article className="compact-card" key={delegation.id}>
            <span className="status">{delegation.status}</span>
            <h3>{delegation.id}</h3>
            <p>For {delegation.annotation}</p>
            <p>Assigned to {delegation.assignee.id}</p>
            {delegation.instruction ? (
              <blockquote>{delegation.instruction}</blockquote>
            ) : null}
            {delegation.status === "queued" ||
            delegation.status === "in_progress" ? (
              <button
                className="button button-danger"
                onClick={() => void onCancel(delegation.id)}
                type="button"
              >
                Cancel delegation
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
