import {
  DocumentIndex,
  projectionRevision,
  sha256Hex,
  type Diagnostic,
  type DstarProjection,
  type DstarProjectionIndex,
  type JsonValue,
} from "@dstar/core";
import {
  encodeJson,
  type PackageRepository,
  type PackageSnapshot,
} from "@dstar/node";

import {
  renderProjection,
  type ProjectionKind,
  type RenderedProjection,
} from "./renderers.js";

export interface PublishProjectionOptions {
  readonly projectionId?: string;
  readonly kinds?: readonly ProjectionKind[];
  readonly createdAt?: string;
}

export interface PublishedProjectionResult {
  readonly snapshot: PackageSnapshot;
  readonly projections: readonly DstarProjection[];
  readonly diagnostics: readonly Diagnostic[];
}

const defaults: Readonly<Record<ProjectionKind, { id: string; path: string }>> =
  {
    html: { id: "projection_html", path: "projections/document.html" },
    markdown: { id: "projection_markdown", path: "projections/document.md" },
    "plain-text": {
      id: "projection_plain_text",
      path: "projections/document.txt",
    },
  };

function kindFor(projection: DstarProjection): ProjectionKind | undefined {
  if (projection.mediaType === "text/html" && projection.role === "reading")
    return "html";
  if (projection.mediaType === "text/markdown" && projection.role === "source")
    return "markdown";
  if (projection.mediaType === "text/plain" && projection.role === "plain-text")
    return "plain-text";
  return undefined;
}

function isReferenced(
  snapshot: PackageSnapshot,
  projectionId: string,
): boolean {
  return snapshot.annotations.some(
    (annotation) => annotation.target.source === projectionId,
  );
}

function deterministicSuffix(
  snapshot: PackageSnapshot,
  kind: ProjectionKind,
): string {
  return sha256Hex(
    new TextEncoder().encode(
      `${snapshot.manifest.revision}\u0000${kind}\u0000dstar-renderer-0.1.0`,
    ),
  ).slice(0, 12);
}

function generationTime(snapshot: PackageSnapshot): string {
  const head = snapshot.changes.find(
    (change) => change.id === snapshot.manifest.headChange,
  );
  return head?.decision?.at ?? head?.createdAt ?? "1970-01-01T00:00:00.000Z";
}

function targetFor(
  snapshot: PackageSnapshot,
  kind: ProjectionKind,
  existing: DstarProjection | undefined,
): { id: string; path: string } {
  if (!existing || !isReferenced(snapshot, existing.id)) {
    const candidate = existing
      ? { id: existing.id, path: existing.path }
      : defaults[kind];
    const collision = snapshot.projections?.projections.some(
      (projection) =>
        projection.path === candidate.path && projection.id !== candidate.id,
    );
    if (!collision) return candidate;
  }
  const suffix = deterministicSuffix(snapshot, kind);
  return {
    id: `${defaults[kind].id}_${suffix}`,
    path: `projections/document-${suffix}.${defaults[kind].path.split(".").at(-1)}`,
  };
}

function recordFor(
  snapshot: PackageSnapshot,
  target: { id: string; path: string },
  rendered: RenderedProjection,
  createdAt: string,
): DstarProjection {
  return {
    id: target.id,
    role: rendered.role,
    mediaType: rendered.mediaType,
    path: target.path,
    reviewable: rendered.reviewable,
    generatedFromRevision: snapshot.manifest.revision,
    revision: rendered.revision,
    generator: {
      actor: {
        type: "service",
        id: "service_dstar_renderer",
        name: "DSTAR deterministic renderer",
      },
      version: "0.1.0",
      createdAt,
    },
    ...(rendered.segments.length > 0
      ? { segments: [...rendered.segments] }
      : {}),
  };
}

export function verifyRenderedProjection(
  snapshot: PackageSnapshot,
  rendered: RenderedProjection,
): void {
  if (projectionRevision(rendered.bytes) !== rendered.revision)
    throw new Error("Projection byte revision mismatch");
  const documentIndex = new DocumentIndex(snapshot.document);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
    rendered.bytes,
  );
  const visibleText = (value: string): string =>
    value
      .replaceAll(/<[^>]*>/gu, "")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&#96;", "`")
      .replaceAll("&amp;", "&");
  const ids = new Set<string>();
  let priorEnd = -1;
  for (const segment of rendered.segments) {
    if (ids.has(segment.id))
      throw new Error(`Duplicate projection segment ${segment.id}`);
    ids.add(segment.id);
    const quote = segment.selectors.find(
      (selector) => selector.type === "TextQuoteSelector",
    );
    if (
      quote?.type === "TextQuoteSelector" &&
      rendered.kind !== "html" &&
      !decoded.includes(quote.exact)
    )
      throw new Error(`Projection quote is absent for ${segment.id}`);
    const position = segment.selectors.find(
      (selector) => selector.type === "TextPositionSelector",
    );
    if (position?.type === "TextPositionSelector") {
      if (position.start < priorEnd)
        throw new Error("Projection segments are out of reading order");
      priorEnd = position.end;
      if (
        [...decoded].slice(position.start, position.end).join("") !==
        quote?.exact
      )
        throw new Error(
          `Projection position does not match quote for ${segment.id}`,
        );
    }
    const fragment = segment.selectors.find(
      (selector) => selector.type === "FragmentSelector",
    );
    if (fragment?.type === "FragmentSelector") {
      const marker = `data-dstar-segment="${fragment.value}"`;
      if (decoded.split(marker).length !== 2)
        throw new Error(`Projection fragment is not unique for ${segment.id}`);
      const escaped = fragment.value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const element = decoded.match(
        new RegExp(
          `<([a-z][a-z0-9]*)[^>]*data-dstar-segment="${escaped}"[^>]*>([\\s\\S]*?)<\\/\\1>`,
          "u",
        ),
      );
      if (
        !element ||
        (quote?.type === "TextQuoteSelector" &&
          !visibleText(element[2] ?? "").includes(quote.exact))
      )
        throw new Error(
          `Projection fragment quotation mismatch for ${segment.id}`,
        );
    }
    for (const source of segment.derivedFrom) {
      if (source.selector.type === "NodeSelector") {
        if (!documentIndex.nodes.has(source.selector.node))
          throw new Error(`Projection source node is absent for ${segment.id}`);
      } else if (
        !documentIndex.nodes.has(source.selector.start.node) ||
        !documentIndex.nodes.has(source.selector.end.node)
      ) {
        throw new Error(`Projection source range is absent for ${segment.id}`);
      }
    }
  }
  if (rendered.reviewable !== rendered.segments.length > 0)
    throw new Error("Projection reviewability does not match its mappings");
}

export async function publishProjections(
  repository: PackageRepository,
  snapshot: PackageSnapshot,
  options: PublishProjectionOptions = {},
): Promise<PublishedProjectionResult> {
  const existing = snapshot.projections?.projections ?? [];
  let selections: readonly {
    kind: ProjectionKind;
    existing: DstarProjection | undefined;
  }[];
  if (options.projectionId) {
    const selected = existing.find(
      (projection) => projection.id === options.projectionId,
    );
    if (!selected)
      throw new Error(`Projection ${options.projectionId} does not exist`);
    const kind = kindFor(selected);
    if (!kind)
      throw new Error(
        `Projection ${selected.id} is not a deterministic base renderer output`,
      );
    selections = [{ kind, existing: selected }];
  } else if (options.kinds) {
    selections = options.kinds.map((kind) => ({
      kind,
      existing: existing.find((projection) => kindFor(projection) === kind),
    }));
  } else {
    selections = (["html", "markdown", "plain-text"] as const).map((kind) => ({
      kind,
      existing: existing.find((projection) => kindFor(projection) === kind),
    }));
  }

  const writes = new Map<string, Uint8Array>();
  const replacements = new Map(
    existing.map((projection) => [projection.id, projection]),
  );
  const published: DstarProjection[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const selection of selections) {
    const rendered = renderProjection(snapshot, selection.kind);
    verifyRenderedProjection(snapshot, rendered);
    const target = targetFor(snapshot, selection.kind, selection.existing);
    const record = recordFor(
      snapshot,
      target,
      rendered,
      options.createdAt ?? generationTime(snapshot),
    );
    writes.set(target.path, rendered.bytes);
    replacements.set(record.id, record);
    published.push(record);
    diagnostics.push(...rendered.diagnostics);
  }
  const index: DstarProjectionIndex = {
    projections: [...replacements.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
  writes.set(
    "projections/index.json",
    encodeJson(index as unknown as JsonValue),
  );
  if (snapshot.manifest.projections !== "projections/index.json") {
    writes.set(
      "manifest.json",
      encodeJson({
        ...snapshot.manifest,
        projections: "projections/index.json",
      } as unknown as JsonValue),
    );
  }
  const result = await repository.commit(snapshot, {
    expectedSnapshotId: snapshot.snapshotId,
    transactionType: "projection",
    writes,
  });
  return {
    snapshot: result,
    projections: Object.freeze(published),
    diagnostics: Object.freeze(diagnostics),
  };
}
