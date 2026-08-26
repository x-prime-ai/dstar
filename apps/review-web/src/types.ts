import type {
  CanonicalVersionSummary,
  DstarActor,
  DstarAnnotation,
  DstarChange,
  DstarDelegation,
  DstarManifest,
  DstarProjection,
  DstarTarget,
} from "@dstar/core";

export interface SnapshotView {
  readonly snapshotId: string;
  readonly manifest: DstarManifest;
  readonly diagnostics: readonly unknown[];
  readonly capabilities: {
    readonly canonicalEditing: false;
    readonly comment: true;
    readonly delegate: true;
    readonly humanDecision: true;
    readonly embeddedModelRuntime: false;
  };
  readonly projections: readonly (DstarProjection & {
    readonly fresh: boolean;
  })[];
}

export interface TextRunView {
  readonly id: string;
  readonly nodeId: string;
  readonly start: number;
  readonly end: number;
  readonly canonical: true;
  readonly text: string;
}

export interface DocumentView {
  readonly documentRevision: string;
  readonly html: string;
  readonly nodeOrder: readonly string[];
  readonly nodeTexts: Readonly<Record<string, string>>;
  readonly textRuns: readonly TextRunView[];
  readonly diagnostics: readonly unknown[];
}

export interface ProjectionView {
  readonly projection: DstarProjection;
  readonly content: string;
  readonly fresh: boolean;
}

export interface HistoricalDocumentView {
  readonly changeId: string;
  readonly revision: string;
  readonly historical: true;
  readonly html: string;
  readonly diagnostics: readonly unknown[];
}

export interface AnnotationView {
  readonly annotation: DstarAnnotation;
  readonly resolution: { readonly state: string };
}

export interface SessionView {
  readonly csrfToken: string;
  readonly human: DstarActor;
}

export interface SelectionCapture {
  readonly target: DstarTarget;
  readonly canonicalTargets?: DstarAnnotation["canonicalTargets"];
  readonly exact: string;
  readonly sourceLabel: string;
}

export interface WorkspaceState {
  readonly snapshot: SnapshotView;
  readonly document: DocumentView;
  readonly annotations: readonly AnnotationView[];
  readonly delegations: readonly DstarDelegation[];
  readonly changes: readonly DstarChange[];
  readonly versions: readonly CanonicalVersionSummary[];
  readonly sources: { readonly sources: readonly unknown[] };
}
