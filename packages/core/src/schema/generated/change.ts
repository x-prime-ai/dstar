/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

export type DSTAR01Change = ({
[k: string]: unknown
} & {
id: Id
kind: ("genesis" | "update")
idempotencyKey: string
baseChange?: Id
baseRevision?: Revision
author: Actor
request?: Request
/**
 * @minItems 1
 */
operations: [(CreateDocumentOperation | UpdateOperation), ...((CreateDocumentOperation | UpdateOperation))[]]
status: ("proposed" | "accepted" | "rejected" | "superseded")
createdAt: string
motivatedBy?: Id[]
sources?: Id[]
decision?: Decision
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
 * via the `definition` "revision".
 */
export type Revision = string
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "humanActor".
 */
export type HumanActor = (Actor & {
type: "human"
[k: string]: unknown
})
export type DSTAR01BaseDocument = (Node & {
type?: "document"
[k: string]: unknown
})
export type Node = ({
[k: string]: unknown
} & {
id: string
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
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "updateOperation".
 */
export type UpdateOperation = (ReplaceTextOperation | ReplaceInlineOperation | InsertNodeOperation | DeleteNodeOperation | MoveNodeOperation | SetAttrsOperation)

/**
 * This interface was referenced by `undefined`'s JSON-Schema
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
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "request".
 */
export interface Request {
actor: HumanActor
body: string
createdAt: string
/**
 * This interface was referenced by `Request`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "createDocumentOperation".
 */
export interface CreateDocumentOperation {
id: Id
op: "create_document"
value: DSTAR01BaseDocument
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "replaceTextOperation".
 */
export interface ReplaceTextOperation {
id: Id
op: "replace_text"
target: Target
precondition: NodePrecondition
range: Range
value: string
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "target".
 */
export interface Target {
node: Id
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "nodePrecondition".
 */
export interface NodePrecondition {
nodeRevision: Revision
expectedText?: string
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "range".
 */
export interface Range {
start: number
end: number
unit: "unicode-code-point"
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "replaceInlineOperation".
 */
export interface ReplaceInlineOperation {
id: Id
op: "replace_inline"
target: Target
precondition: NodePrecondition
value: Inline[]
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "insertNodeOperation".
 */
export interface InsertNodeOperation {
id: Id
op: "insert_node"
destination: Destination
destinationPrecondition: ParentPrecondition
value: Node
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "destination".
 */
export interface Destination {
parent: Id
before?: Id
after?: Id
index?: number
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "parentPrecondition".
 */
export interface ParentPrecondition {
nodeRevision: Revision
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "deleteNodeOperation".
 */
export interface DeleteNodeOperation {
id: Id
op: "delete_node"
target: Target
precondition: NodePrecondition
origin: Origin
originPrecondition: ParentPrecondition
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "origin".
 */
export interface Origin {
parent: Id
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "moveNodeOperation".
 */
export interface MoveNodeOperation {
id: Id
op: "move_node"
target: Target
precondition: NodePrecondition
origin: Origin
originPrecondition: ParentPrecondition
destination: Destination
destinationPrecondition: ParentPrecondition
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "setAttrsOperation".
 */
export interface SetAttrsOperation {
id: Id
op: "set_attrs"
target: Target
precondition: NodePrecondition
value: ({
[k: string]: unknown
} | null)
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "decision".
 */
export interface Decision {
status: ("accepted" | "rejected" | "superseded")
actor: HumanActor
at: string
reason?: string
resultRevision?: Revision
/**
 * This interface was referenced by `Decision`'s JSON-Schema definition
 * via the `patternProperty` "^x-".
 */
[k: string]: unknown
}
