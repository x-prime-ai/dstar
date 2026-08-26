/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

export type DSTAR01BaseDocument = (Node & {
type?: "document"
[k: string]: unknown
})
export type Node = ({
[k: string]: unknown
} & {
id: Id
type: string
attrs?: {
[k: string]: unknown
}
content?: Inline[]
children?: Node[]
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
})
export type Id = string
export type Inline = ({
[k: string]: unknown
} & {
type: string
text?: string
attrs?: {
[k: string]: unknown
}
marks?: Mark[]
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
})
export type Mark = ({
[k: string]: unknown
} & {
type: string
attrs?: {
[k: string]: unknown
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
})
