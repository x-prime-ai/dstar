/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

export type DSTAR01Delegation = ({
[k: string]: unknown
} & {
id: Id
annotation: Id
assignee: AgentActor
createdBy: HumanActor
instruction?: string
status: ("queued" | "in_progress" | "completed" | "failed" | "cancelled")
createdAt: string
completedAt?: string
completedBy?: Actor
reason?: string
results?: Result[]
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
 * via the `definition` "agentActor".
 */
export type AgentActor = (Actor & {
type: "agent"
[k: string]: unknown
})
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
 * via the `definition` "result".
 */
export type Result = (ChangeResult | ReplyResult)

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
 * via the `definition` "changeResult".
 */
export interface ChangeResult {
type: "change"
change: Id
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "replyResult".
 */
export interface ReplyResult {
type: "reply"
annotation: Id
reply: Id
}
