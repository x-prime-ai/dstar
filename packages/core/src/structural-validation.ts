import Ajv2020Import, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

import { createDiagnostic, type Diagnostic } from "./diagnostics.js";
import type {
  DstarAnnotation,
  DstarChange,
  DstarDocument,
  DstarManifest,
  DstarProjectionIndex,
  DstarSources,
} from "./protocol.js";
import { SCHEMA_DOCUMENTS } from "./schema/generated/schema-documents.js";
import { SCHEMA_IDS, type SchemaName } from "./schema/index.js";

export interface SchemaValueMap {
  readonly annotation: DstarAnnotation;
  readonly change: DstarChange;
  readonly document: DstarDocument;
  readonly manifest: DstarManifest;
  readonly projection: DstarProjectionIndex;
  readonly sources: DstarSources;
}

export interface StructuralValidation<T> {
  readonly valid: boolean;
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
}

let validators: ReadonlyMap<SchemaName, ValidateFunction> | undefined;

interface AjvRuntime {
  addSchema(schema: object): AjvRuntime;
  getSchema(id: string): ValidateFunction | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (
  options: Record<string, unknown>,
) => AjvRuntime;
const addFormats = addFormatsImport as unknown as (
  ajv: AjvRuntime,
) => AjvRuntime;

function buildValidators(): ReadonlyMap<SchemaName, ValidateFunction> {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
  });
  addFormats(ajv);
  for (const schema of Object.values(SCHEMA_DOCUMENTS)) ajv.addSchema(schema);
  return new Map(
    (Object.keys(SCHEMA_IDS) as SchemaName[]).map((name) => {
      const validator = ajv.getSchema(SCHEMA_IDS[name]);
      if (!validator)
        throw new Error(`Generated validator missing for schema ${name}`);
      return [name, validator];
    }),
  );
}

function diagnosticFromAjv(name: SchemaName, error: ErrorObject): Diagnostic {
  return createDiagnostic("SCHEMA_VALIDATION_FAILED", {
    summary: `${name} failed ${error.keyword} validation${error.message ? `: ${error.message}` : ""}`,
    location: { pointer: error.instancePath || "/" },
    details: {
      schema: name,
      keyword: error.keyword,
      schemaPath: error.schemaPath,
      params: error.params,
    },
  });
}

export function validateStructure<Name extends SchemaName>(
  name: Name,
  value: unknown,
): StructuralValidation<SchemaValueMap[Name]> {
  validators ??= buildValidators();
  const validator = validators.get(name);
  if (!validator) throw new Error(`Unknown schema ${name}`);
  const valid = validator(value);
  const diagnostics = valid
    ? []
    : (validator.errors ?? []).map((error) => diagnosticFromAjv(name, error));
  return Object.freeze({
    valid,
    ...(valid ? { value: value as SchemaValueMap[Name] } : {}),
    diagnostics: Object.freeze(diagnostics),
  });
}
