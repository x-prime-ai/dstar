import { createDiagnostic, type Diagnostic } from "./diagnostics.js";
import { acceptedChain, materializeVersion } from "./history.js";
import { DuplicateIdError, PackageIndex } from "./indexes.js";
import { isPackagePath } from "./paths.js";
import type {
  DstarAnnotation,
  DstarDocument,
  DstarNodeRangeSelector,
  DstarNodeSelector,
  InMemoryPackage,
} from "./protocol.js";
import { documentRevision } from "./revisions.js";
import { resolveCanonicalTarget } from "./selectors.js";
import { validateStructure } from "./structural-validation.js";
import { validateBaseProfile } from "./profile-validation.js";

export interface PackageValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly index?: PackageIndex;
}

function missing(summary: string, objectId?: string): Diagnostic {
  return createDiagnostic("REF_MISSING", {
    summary,
    ...(objectId ? { location: { objectId } } : {}),
  });
}

function authority(summary: string, objectId?: string): Diagnostic {
  return createDiagnostic("AUTH_CHANGE_AUTHOR_NOT_AGENT", {
    summary,
    ...(objectId ? { location: { objectId } } : {}),
  });
}

function documentForRevision(
  pkg: InMemoryPackage,
  revision: string,
): DstarDocument | undefined {
  const { chain } = acceptedChain(pkg);
  for (const change of chain) {
    if (change.decision?.resultRevision !== revision) continue;
    const materialization = materializeVersion(pkg, change.id);
    if (materialization.valid) return materialization.document;
  }
  return undefined;
}

function validateCanonicalSelector(
  pkg: InMemoryPackage,
  revision: string,
  selector: DstarNodeSelector | DstarNodeRangeSelector,
  objectId: string,
): Diagnostic[] {
  const document = documentForRevision(pkg, revision);
  if (!document)
    return [
      missing(
        `Canonical revision ${revision} is not an accepted version.`,
        objectId,
      ),
    ];
  const resolution = resolveCanonicalTarget(document, {
    source: "document",
    revision,
    selector,
  });
  if (resolution.state !== "exact") {
    return [
      missing(
        `Canonical selector is not exact at recorded revision ${revision}.`,
        objectId,
      ),
    ];
  }
  return [];
}

function validateAnnotation(
  pkg: InMemoryPackage,
  index: PackageIndex,
  annotation: DstarAnnotation,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (annotation.target.source === "document") {
    if (annotation.scope !== "canonical") {
      diagnostics.push(
        missing(
          "A direct document target must use canonical scope.",
          annotation.id,
        ),
      );
    }
    if (
      annotation.target.selector.type !== "NodeSelector" &&
      annotation.target.selector.type !== "NodeRangeSelector"
    ) {
      diagnostics.push(
        missing(
          "A document target must use a canonical selector.",
          annotation.id,
        ),
      );
    } else {
      diagnostics.push(
        ...validateCanonicalSelector(
          pkg,
          annotation.target.revision,
          annotation.target.selector,
          annotation.id,
        ),
      );
    }
  } else {
    const projection = index.projections.get(annotation.target.source);
    if (!projection || !projection.reviewable) {
      diagnostics.push(
        missing(
          "Projection target must reference a reviewable projection.",
          annotation.id,
        ),
      );
    } else if (projection.revision !== annotation.target.revision) {
      diagnostics.push(
        missing(
          "Annotation projection revision does not match its projection.",
          annotation.id,
        ),
      );
    } else {
      const segmentOrder = new Map(
        (projection.segments ?? []).map((segment, order) => [
          segment.id,
          order,
        ]),
      );
      const selector = annotation.target.selector;
      if (selector.type === "SegmentSelector") {
        if (!segmentOrder.has(selector.segment)) {
          diagnostics.push(
            missing("Projection annotation segment is missing.", annotation.id),
          );
        }
      } else if (selector.type === "SegmentRangeSelector") {
        const startOrder = segmentOrder.get(selector.start.segment);
        const endOrder = segmentOrder.get(selector.end.segment);
        if (
          startOrder === undefined ||
          endOrder === undefined ||
          startOrder > endOrder
        ) {
          diagnostics.push(
            missing(
              "Projection annotation segment range is missing or reversed.",
              annotation.id,
            ),
          );
        }
      } else {
        diagnostics.push(
          missing(
            "A projection target must use a segment selector.",
            annotation.id,
          ),
        );
      }
    }
    if (
      !annotation.canonicalTargets ||
      annotation.canonicalTargets.length === 0
    ) {
      diagnostics.push(
        missing(
          "Projection annotations require copied canonical targets.",
          annotation.id,
        ),
      );
    }
  }
  for (const target of annotation.canonicalTargets ?? []) {
    const primaryProjection =
      annotation.target.source === "document"
        ? undefined
        : index.projections.get(annotation.target.source);
    if (
      primaryProjection &&
      target.revision !== primaryProjection.generatedFromRevision
    ) {
      diagnostics.push(
        missing(
          "Copied canonical target revision must equal projection generatedFromRevision.",
          annotation.id,
        ),
      );
    }
    diagnostics.push(
      ...validateCanonicalSelector(
        pkg,
        target.revision,
        target.selector,
        annotation.id,
      ),
    );
  }
  if (
    annotation.status === "resolved" &&
    annotation.resolvedBy?.type !== "human"
  ) {
    diagnostics.push(
      createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN", {
        summary: "Annotation resolution must identify a human actor.",
        location: { objectId: annotation.id },
      }),
    );
  }
  return diagnostics;
}

export function validateInMemoryPackage(
  pkg: InMemoryPackage,
): PackageValidation {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...validateStructure("manifest", pkg.manifest).diagnostics);
  diagnostics.push(...validateStructure("document", pkg.document).diagnostics);
  for (const annotation of pkg.annotations) {
    diagnostics.push(
      ...validateStructure("annotation", annotation).diagnostics,
    );
  }
  for (const delegation of pkg.delegations) {
    diagnostics.push(
      ...validateStructure("delegation", delegation).diagnostics,
    );
  }
  for (const change of pkg.changes)
    diagnostics.push(...validateStructure("change", change).diagnostics);
  if (pkg.sources)
    diagnostics.push(...validateStructure("sources", pkg.sources).diagnostics);
  if (pkg.projections)
    diagnostics.push(
      ...validateStructure("projection", pkg.projections).diagnostics,
    );
  diagnostics.push(...validateBaseProfile(pkg.document, pkg.manifest.profiles));

  let index: PackageIndex | undefined;
  try {
    index = new PackageIndex(pkg);
  } catch (error) {
    diagnostics.push(
      createDiagnostic("REF_DUPLICATE_ID", {
        summary:
          error instanceof DuplicateIdError
            ? error.message
            : "Duplicate package identifier.",
      }),
    );
  }
  if (!index) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const actualRevision = documentRevision(pkg.document);
  if (actualRevision !== pkg.manifest.revision) {
    diagnostics.push(
      createDiagnostic("REV_MISMATCH", {
        summary: "Manifest revision does not match document.json.",
        details: { expected: pkg.manifest.revision, actual: actualRevision },
      }),
    );
  }
  if (
    pkg.annotations.length > 0 &&
    pkg.manifest.annotations !== "annotations"
  ) {
    diagnostics.push(
      missing(
        "Manifest must declare the annotations entrypoint when annotations exist.",
      ),
    );
  }
  if (
    pkg.delegations.length > 0 &&
    pkg.manifest.delegations !== "delegations"
  ) {
    diagnostics.push(
      missing(
        "Manifest must declare the delegations entrypoint when delegations exist.",
      ),
    );
  }
  if (pkg.sources && pkg.manifest.sources !== "sources.json") {
    diagnostics.push(
      missing(
        "Manifest must declare sources.json when the source registry exists.",
      ),
    );
  }
  if (!pkg.sources && pkg.manifest.sources === "sources.json") {
    diagnostics.push(
      missing(
        "Manifest sources entrypoint is declared but the source registry is absent.",
      ),
    );
  }
  if (
    pkg.projections &&
    pkg.manifest.projections !== "projections/index.json"
  ) {
    diagnostics.push(
      missing(
        "Manifest must declare projections/index.json when projections exist.",
      ),
    );
  }
  if (
    !pkg.projections &&
    pkg.manifest.projections === "projections/index.json"
  ) {
    diagnostics.push(
      missing(
        "Manifest projection entrypoint is declared but the projection index is absent.",
      ),
    );
  }

  const chain = acceptedChain(pkg);
  diagnostics.push(...chain.diagnostics);
  if (chain.chain.some((change) => change.id === pkg.manifest.headChange)) {
    diagnostics.push(
      ...materializeVersion(pkg, pkg.manifest.headChange).diagnostics,
    );
  }

  for (const change of pkg.changes) {
    if (change.author.type !== "agent")
      diagnostics.push(
        authority("Every change author must be an agent.", change.id),
      );
    if (
      change.status !== "proposed" &&
      change.decision?.actor.type !== "human"
    ) {
      diagnostics.push(
        createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN", {
          summary: "Every portable proposal decision must identify a human.",
          location: { objectId: change.id },
        }),
      );
    }
    const operationIds = new Set<string>();
    for (const operation of change.operations) {
      if (operationIds.has(operation.id)) {
        diagnostics.push(
          createDiagnostic("REF_DUPLICATE_ID", {
            summary: "Operation ID is duplicated within a change.",
            location: { objectId: change.id },
          }),
        );
      }
      operationIds.add(operation.id);
    }
    if (change.kind === "update") {
      const base = index.changes.get(change.baseChange ?? "");
      if (
        !base ||
        base.status !== "accepted" ||
        base.decision?.resultRevision !== change.baseRevision
      ) {
        diagnostics.push(
          missing(
            "Update bases must identify one accepted canonical version.",
            change.id,
          ),
        );
      }
    }
    for (const annotationId of change.motivatedBy ?? []) {
      if (!index.annotations.has(annotationId))
        diagnostics.push(
          missing("motivatedBy annotation is missing.", change.id),
        );
    }
    for (const delegationId of change.fulfills ?? []) {
      if (!index.delegations.has(delegationId))
        diagnostics.push(
          missing("fulfilled delegation is missing.", change.id),
        );
    }
    for (const sourceId of change.sources ?? []) {
      if (!index.sources.has(sourceId))
        diagnostics.push(missing("Change source is missing.", change.id));
    }
  }

  for (const annotation of pkg.annotations)
    diagnostics.push(...validateAnnotation(pkg, index, annotation));

  for (const delegation of pkg.delegations) {
    const annotation = index.annotations.get(delegation.annotation);
    if (!annotation)
      diagnostics.push(
        missing("Delegation annotation is missing.", delegation.id),
      );
    if (delegation.assignee.type !== "agent")
      diagnostics.push(
        authority("Delegation assignee must be an agent.", delegation.id),
      );
    if (delegation.createdBy.type !== "human") {
      diagnostics.push(
        createDiagnostic("AUTH_DECISION_ACTOR_NOT_HUMAN", {
          summary: "Delegation creator must be a human.",
          location: { objectId: delegation.id },
        }),
      );
    }
    for (const result of delegation.results ?? []) {
      if (result.type === "change") {
        const change = index.changes.get(result.change);
        if (
          !change ||
          change.author.id !== delegation.assignee.id ||
          change.author.type !== "agent"
        ) {
          diagnostics.push(
            missing(
              "Delegation change result is missing or has the wrong agent author.",
              delegation.id,
            ),
          );
        }
      } else {
        const reply = index.getReply(result.annotation, result.reply);
        if (
          !reply ||
          reply.annotationId !== delegation.annotation ||
          (reply.reply as { author?: { id?: string; type?: string } }).author
            ?.id !== delegation.assignee.id ||
          (reply.reply as { author?: { id?: string; type?: string } }).author
            ?.type !== "agent"
        ) {
          diagnostics.push(
            missing(
              "Delegation reply result is missing or has the wrong agent author.",
              delegation.id,
            ),
          );
        }
      }
    }
  }

  for (const source of pkg.sources?.sources ?? []) {
    if (
      source.type === "file" &&
      (typeof source.path !== "string" || !isPackagePath(source.path))
    ) {
      diagnostics.push(
        missing("File source path is not a valid package path.", source.id),
      );
    }
  }

  for (const projection of pkg.projections?.projections ?? []) {
    if (!isPackagePath(projection.path))
      diagnostics.push(missing("Projection path is invalid.", projection.id));
    if (!documentForRevision(pkg, projection.generatedFromRevision)) {
      diagnostics.push(
        missing(
          "Projection generatedFromRevision is not an accepted canonical version.",
          projection.id,
        ),
      );
    }
    const segmentIds = new Set<string>();
    if (projection.reviewable && (projection.segments?.length ?? 0) === 0) {
      diagnostics.push(
        missing(
          "A reviewable projection must contain mapped segments.",
          projection.id,
        ),
      );
    }
    for (const segment of projection.segments ?? []) {
      if (segmentIds.has(segment.id)) {
        diagnostics.push(
          createDiagnostic("REF_DUPLICATE_ID", {
            summary: "Projection segment ID is duplicated within a projection.",
            location: { objectId: projection.id },
          }),
        );
      }
      segmentIds.add(segment.id);
      for (const mapping of segment.derivedFrom) {
        diagnostics.push(
          ...validateCanonicalSelector(
            pkg,
            projection.generatedFromRevision,
            mapping.selector,
            projection.id,
          ),
        );
      }
    }
  }

  const valid = !diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  return Object.freeze({
    valid,
    diagnostics: Object.freeze(diagnostics),
    index,
  });
}
