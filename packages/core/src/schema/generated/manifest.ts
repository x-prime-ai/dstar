/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

/**
 * This interface was referenced by `DSTAR01Manifest`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string
/**
 * This interface was referenced by `DSTAR01Manifest`'s JSON-Schema
 * via the `definition` "revision".
 */
export type Revision = string

export interface DSTAR01Manifest {
dstar: "0.1"
id: Id
revision: Revision
headChange: Id
title: string
/**
 * @minItems 1
 */
profiles: [string, ...(string)[]]
document: "document.json"
annotations?: "annotations"
sources?: "sources.json"
changes: "changes"
assets?: "assets"
projections?: "projections/index.json"
/**
 * This interface was referenced by `DSTAR01Manifest`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
