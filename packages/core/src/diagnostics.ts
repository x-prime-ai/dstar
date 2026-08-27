export const DIAGNOSTIC_REGISTRY = {
  PKG_PATH_INVALID: {
    family: "PKG",
    defaultSeverity: "error",
    summary: "A package entry path or file type is unsafe.",
  },
  PKG_ENTRY_MISSING: {
    family: "PKG",
    defaultSeverity: "error",
    summary: "A required package entry is missing.",
  },
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
  AUTH_DECISION_ACTOR_NOT_HUMAN: {
    family: "AUTH",
    defaultSeverity: "error",
    summary: "Portable proposal decisions must identify an authorized human.",
  },
  AUTH_ANNOTATION_ASSIGNEE_NOT_HUMAN: {
    family: "AUTH",
    defaultSeverity: "error",
    summary: "Portable annotation assignment must identify a human.",
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
  TXN_SNAPSHOT_STALE: {
    family: "TXN",
    defaultSeverity: "error",
    summary: "The package changed after the command snapshot was created.",
  },
  TXN_LOCKED: {
    family: "TXN",
    defaultSeverity: "error",
    summary: "Another package mutation currently owns the write lock.",
  },
  TXN_RECOVERY_REQUIRED: {
    family: "TXN",
    defaultSeverity: "error",
    summary:
      "A package transaction could not be completed or rolled back safely.",
  },
  COMMAND_IDEMPOTENCY_MISMATCH: {
    family: "COMMAND",
    defaultSeverity: "error",
    summary: "An idempotency key was reused with different command arguments.",
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
