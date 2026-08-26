export const DIAGNOSTIC_REGISTRY = {
  JSON_PARSE_FAILED: {
    family: "JSON",
    defaultSeverity: "error",
    summary: "JSON input could not be parsed as valid I-JSON.",
  },
  SCHEMA_VALIDATION_FAILED: {
    family: "SCHEMA",
    defaultSeverity: "error",
    summary: "A protocol object does not satisfy its normative JSON Schema.",
  },
  PROFILE_UNSUPPORTED: {
    family: "PROFILE",
    defaultSeverity: "warning",
    summary: "A declared content profile is not supported by this operation.",
  },
  REF_MISSING: {
    family: "REF",
    defaultSeverity: "error",
    summary: "A referenced protocol object does not exist.",
  },
  REF_DUPLICATE_ID: {
    family: "REF",
    defaultSeverity: "error",
    summary: "An identifier is duplicated within its required scope.",
  },
  REV_MISMATCH: {
    family: "REV",
    defaultSeverity: "error",
    summary: "A computed revision does not match the recorded revision.",
  },
  HISTORY_CHAIN_INVALID: {
    family: "HISTORY",
    defaultSeverity: "error",
    summary: "The accepted change chain is incomplete or inconsistent.",
  },
  AUTH_CHANGE_AUTHOR_NOT_AGENT: {
    family: "AUTH",
    defaultSeverity: "error",
    summary: "Canonical content proposals must be authored by an agent.",
  },
  AUTH_DECISION_ACTOR_NOT_HUMAN: {
    family: "AUTH",
    defaultSeverity: "error",
    summary: "Portable proposal decisions must identify an authorized human.",
  },
  OP_PRECONDITION_FAILED: {
    family: "OP",
    defaultSeverity: "error",
    summary: "An operation precondition does not match the working document.",
  },
  OP_TARGET_MISSING: {
    family: "OP",
    defaultSeverity: "error",
    summary: "An operation target does not exist in the working document.",
  },
  OP_INVALID: {
    family: "OP",
    defaultSeverity: "error",
    summary: "An operation cannot be applied with the specified semantics.",
  },
  LIMIT_EXCEEDED: {
    family: "LIMIT",
    defaultSeverity: "error",
    summary: "Input exceeded a configured resource limit.",
  },
} as const;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_REGISTRY;
export type DiagnosticFamily =
  (typeof DIAGNOSTIC_REGISTRY)[DiagnosticCode]["family"];
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticLocation {
  readonly objectId?: string;
  readonly pointer?: string;
  readonly packagePath?: string;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly family: DiagnosticFamily;
  readonly severity: DiagnosticSeverity;
  readonly summary: string;
  readonly location?: DiagnosticLocation;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface DiagnosticInput {
  readonly severity?: DiagnosticSeverity;
  readonly summary?: string;
  readonly location?: DiagnosticLocation;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function createDiagnostic(
  code: DiagnosticCode,
  input: DiagnosticInput = {},
): Diagnostic {
  const definition = DIAGNOSTIC_REGISTRY[code];
  return {
    code,
    family: definition.family,
    severity: input.severity ?? definition.defaultSeverity,
    summary: input.summary ?? definition.summary,
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}
