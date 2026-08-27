import type * as AnnotationSchema from "./schema/generated/annotation.js";
import type * as ChangeSchema from "./schema/generated/change.js";
import type * as DocumentSchema from "./schema/generated/document.js";
import type * as ManifestSchema from "./schema/generated/manifest.js";
import type * as ProjectionSchema from "./schema/generated/projection.js";
import type * as SourcesSchema from "./schema/generated/sources.js";

export type DstarDocument = DocumentSchema.DSTAR01BaseDocument;
export type DstarNode = DocumentSchema.Node;
export type DstarInline = DocumentSchema.Inline;
export type DstarMark = DocumentSchema.Mark;
export type DstarManifest = ManifestSchema.DSTAR01Manifest;
export type DstarAnnotation = AnnotationSchema.DSTAR01AnnotationThread;
export type DstarChange = ChangeSchema.DSTAR01Change;
export type DstarUpdateOperation = ChangeSchema.UpdateOperation;
export type DstarCreateDocumentOperation = ChangeSchema.CreateDocumentOperation;
export type DstarProjectionIndex = ProjectionSchema.DSTAR01ProjectionIndex;
export type DstarProjection = ProjectionSchema.Projection;
export type DstarSources = SourcesSchema.DSTAR01Sources;
export type DstarActor = AnnotationSchema.Actor;
export type DstarNodeSelector = AnnotationSchema.NodeSelector;
export type DstarNodeRangeSelector = AnnotationSchema.NodeRangeSelector;
export type DstarTarget = AnnotationSchema.Target;

export interface InMemoryPackage {
  readonly manifest: DstarManifest;
  readonly document: DstarDocument;
  readonly annotations: readonly DstarAnnotation[];
  readonly changes: readonly DstarChange[];
  readonly sources?: DstarSources;
  readonly projections?: DstarProjectionIndex;
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
