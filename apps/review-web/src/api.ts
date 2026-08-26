import type {
  AnnotationView,
  DocumentView,
  HistoricalDocumentView,
  ProjectionView,
  SessionView,
  SnapshotView,
  WorkspaceState,
} from "./types.js";
import type {
  CanonicalVersionSummary,
  DstarChange,
  DstarDelegation,
} from "@dstar/core";

export class WorkspaceApi {
  readonly token: string;
  csrfToken = "";

  constructor(token: string) {
    this.token = token;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.method === "POST" ? { "X-DSTAR-CSRF": this.csrfToken } : {}),
        ...init.headers,
      },
    });
    const value = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new Error(value.error ?? `Request failed (${response.status})`);
    return value;
  }

  async initialize(): Promise<SessionView> {
    const session = await this.request<SessionView>("/session");
    this.csrfToken = session.csrfToken;
    return session;
  }

  async state(): Promise<WorkspaceState> {
    const [
      snapshot,
      document,
      annotations,
      delegations,
      changes,
      versions,
      sources,
    ] = await Promise.all([
      this.request<SnapshotView>("/snapshot"),
      this.request<DocumentView>("/document"),
      this.request<readonly AnnotationView[]>("/annotations"),
      this.request<readonly DstarDelegation[]>("/delegations"),
      this.request<readonly DstarChange[]>("/changes"),
      this.request<readonly CanonicalVersionSummary[]>("/versions"),
      this.request<{ readonly sources: readonly unknown[] }>("/sources"),
    ]);
    return {
      snapshot,
      document,
      annotations,
      delegations,
      changes,
      versions,
      sources,
    };
  }

  projection(id: string): Promise<ProjectionView> {
    return this.request(`/projections/${encodeURIComponent(id)}`);
  }

  historicalDocument(id: string): Promise<HistoricalDocumentView> {
    return this.request(`/versions/${encodeURIComponent(id)}/document`);
  }

  simulation(id: string): Promise<Record<string, unknown>> {
    return this.request(`/changes/${encodeURIComponent(id)}/simulation`);
  }

  mutate(
    path: string,
    snapshotId: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly snapshotId: string }> {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        expectedSnapshotId: snapshotId,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
  }

  watchInvalidations(signal: AbortSignal, invalidate: () => void): void {
    void (async () => {
      try {
        const response = await fetch("/api/v1/events", {
          headers: { Authorization: `Bearer ${this.token}` },
          signal,
        });
        if (!response.ok || !response.body) return;
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buffered = "";
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += value;
          const events = buffered.split("\n\n");
          buffered = events.pop() ?? "";
          for (const event of events)
            if (event.includes("event: snapshot")) invalidate();
        }
      } catch (error) {
        if (!signal.aborted)
          console.error("DSTAR_INVALIDATION_STREAM_FAILED", error);
      }
    })();
  }
}

export function tokenFromLocation(): string {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token =
    params.get("token") ?? sessionStorage.getItem("dstar-session-token") ?? "";
  if (token) sessionStorage.setItem("dstar-session-token", token);
  if (window.location.hash)
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  return token;
}
