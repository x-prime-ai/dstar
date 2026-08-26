/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

/**
 * This interface was referenced by `DSTAR01Sources`'s JSON-Schema
 * via the `definition` "packageRelativePath".
 */
export type PackageRelativePath = string

export interface DSTAR01Sources {
sources: {
id: string
type: ("url" | "file" | "citation")
title: string
url?: string
path?: PackageRelativePath
accessedAt?: string
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}[]
}
