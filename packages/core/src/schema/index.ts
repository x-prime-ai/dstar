export * as AnnotationSchema from "./generated/annotation.js";
export * as ChangeSchema from "./generated/change.js";
export * as DelegationSchema from "./generated/delegation.js";
export * as DocumentSchema from "./generated/document.js";
export * as ManifestSchema from "./generated/manifest.js";
export * as ProjectionSchema from "./generated/projection.js";
export * as SourcesSchema from "./generated/sources.js";
export { SCHEMA_DOCUMENTS } from "./generated/schema-documents.js";

export const SCHEMA_IDS = {
  annotation: "https://dstar.dev/spec/0.1/schemas/annotation.schema.json",
  change: "https://dstar.dev/spec/0.1/schemas/change.schema.json",
  delegation: "https://dstar.dev/spec/0.1/schemas/delegation.schema.json",
  document: "https://dstar.dev/spec/0.1/schemas/document.schema.json",
  manifest: "https://dstar.dev/spec/0.1/schemas/manifest.schema.json",
  projection: "https://dstar.dev/spec/0.1/schemas/projection.schema.json",
  sources: "https://dstar.dev/spec/0.1/schemas/sources.schema.json",
} as const;

export type SchemaName = keyof typeof SCHEMA_IDS;
