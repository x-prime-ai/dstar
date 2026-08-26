/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

export type DSTAR01AnnotationThread = ({
[k: string]: unknown
} & {
id: Id
type: string
purpose: ("discussion" | "question" | "change-request")
scope: ("canonical" | "projection" | "both")
target: Target
/**
 * @minItems 1
 */
canonicalTargets?: [CanonicalTarget, ...(CanonicalTarget)[]]
body: string
author: Actor
replies?: Reply[]
/**
 * @minItems 1
 */
audience?: [("human" | "agent" | "service"), ...(("human" | "agent" | "service"))[]]
status: ("open" | "resolved")
createdAt: string
resolvedAt?: string
resolvedBy?: HumanActor
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
})
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "target".
 */
export type Target = ({
[k: string]: unknown
} & {
source: Id
revision: Revision
selector: (NodeSelector | NodeRangeSelector | SegmentSelector | SegmentRangeSelector)
})
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "revision".
 */
export type Revision = string
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "refinedSelector".
 */
export type RefinedSelector = (TextPositionSelector | TextQuoteSelector)
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "humanActor".
 */
export type HumanActor = (Actor & {
type: "human"
[k: string]: unknown
})

/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "nodeSelector".
 */
export interface NodeSelector {
type: "NodeSelector"
node: Id
/**
 * @minItems 1
 * @maxItems 2
 */
refinedBy?: [RefinedSelector]|[RefinedSelector, RefinedSelector]
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "textPositionSelector".
 */
export interface TextPositionSelector {
type: "TextPositionSelector"
start: number
end: number
unit: "unicode-code-point"
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "textQuoteSelector".
 */
export interface TextQuoteSelector {
type: "TextQuoteSelector"
exact: string
prefix?: string
suffix?: string
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
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
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "nodePoint".
 */
export interface NodePoint {
node: Id
offset: number
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "segmentSelector".
 */
export interface SegmentSelector {
type: "SegmentSelector"
segment: Id
/**
 * @minItems 1
 * @maxItems 2
 */
refinedBy?: [RefinedSelector]|[RefinedSelector, RefinedSelector]
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "segmentRangeSelector".
 */
export interface SegmentRangeSelector {
type: "SegmentRangeSelector"
start: SegmentPoint
end: SegmentPoint
unit: "unicode-code-point"
exact: string
prefix?: string
suffix?: string
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "segmentPoint".
 */
export interface SegmentPoint {
segment: Id
offset: number
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "canonicalTarget".
 */
export interface CanonicalTarget {
relation: ("exact" | "transformed" | "summarizes")
source: "document"
revision: Revision
selector: (NodeSelector | NodeRangeSelector)
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "actor".
 */
export interface Actor {
type: ("human" | "agent" | "service")
id: Id
name?: string
model?: string
provider?: string
/**
 * This interface was referenced by `Actor`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "reply".
 */
export interface Reply {
id: Id
body: string
author: Actor
createdAt: string
/**
 * This interface was referenced by `Reply`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
