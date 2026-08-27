/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "projection".
 */
export type Projection = ({
[k: string]: unknown
} & {
id: Id
role: string
mediaType: string
path: PackageRelativePath
reviewable: boolean
generatedFromRevision: Revision
revision: Revision
generator?: Generator
segments?: Segment[]
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
})
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "packageRelativePath".
 */
export type PackageRelativePath = string
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "revision".
 */
export type Revision = string
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "projectionSelector".
 */
export type ProjectionSelector = (TextPositionSelector | TextQuoteSelector | FragmentSelector)

export interface DSTAR01ProjectionIndex {
projections: Projection[]
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "generator".
 */
export interface Generator {
actor: Actor
version?: string
createdAt?: string
/**
 * This interface was referenced by `Generator`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "actor".
 */
export interface Actor {
type: ("human" | "service")
id: Id
name?: string
/**
 * This interface was referenced by `Actor`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "segment".
 */
export interface Segment {
id: Id
/**
 * @minItems 1
 */
selectors: [ProjectionSelector, ...(ProjectionSelector)[]]
/**
 * @minItems 1
 */
derivedFrom: [CanonicalTarget, ...(CanonicalTarget)[]]
/**
 * This interface was referenced by `Segment`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "textPositionSelector".
 */
export interface TextPositionSelector {
type: "TextPositionSelector"
start: number
end: number
unit: "unicode-code-point"
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "textQuoteSelector".
 */
export interface TextQuoteSelector {
type: "TextQuoteSelector"
exact: string
prefix?: string
suffix?: string
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "fragmentSelector".
 */
export interface FragmentSelector {
type: "FragmentSelector"
value: string
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "canonicalTarget".
 */
export interface CanonicalTarget {
relation: ("exact" | "transformed" | "summarizes")
selector: (NodeSelector | NodeRangeSelector)
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "nodeSelector".
 */
export interface NodeSelector {
type: "NodeSelector"
node: Id
/**
 * @minItems 1
 * @maxItems 2
 */
refinedBy?: [(TextPositionSelector | TextQuoteSelector)]|[(TextPositionSelector | TextQuoteSelector), (TextPositionSelector | TextQuoteSelector)]
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "nodeRangeSelector".
 */
export interface NodeRangeSelector {
type: "NodeRangeSelector"
start: NodePoint
end: NodePoint
unit: "unicode-code-point"
exact: string
viewExact?: string
prefix?: string
suffix?: string
}
/**
 * This interface was referenced by `DSTAR01ProjectionIndex`'s JSON-Schema
 * via the `definition` "nodePoint".
 */
export interface NodePoint {
node: Id
offset: number
}
