import {
  createDiagnostic,
  nodeTextStream,
  type Diagnostic,
  type DstarDocument,
  type DstarInline,
  type DstarNode,
} from "@dstar/core";

export interface CanonicalTextRunDescriptor {
  readonly id: string;
  readonly nodeId: string;
  readonly start: number;
  readonly end: number;
  readonly canonical: true;
  readonly inline: DstarInline;
}

export interface RenderNode {
  readonly id: string;
  readonly type: string;
  readonly supported: boolean;
  readonly node: DstarNode;
  readonly text: string;
  readonly textRuns: readonly CanonicalTextRunDescriptor[];
  readonly children: readonly RenderNode[];
}

export interface RenderTree {
  readonly root: RenderNode;
  readonly nodeOrder: readonly string[];
  readonly textRuns: readonly CanonicalTextRunDescriptor[];
  readonly diagnostics: readonly Diagnostic[];
  readonly adapterVersions: Readonly<Record<string, string>>;
}

export interface ProfileAdapter {
  readonly profileId: string;
  readonly version: string;
  readonly supportedNodeTypes: ReadonlySet<string>;
  readonly supportedMarkTypes: ReadonlySet<string>;
}

export class ProfileRegistry {
  readonly #adapters = new Map<string, ProfileAdapter>();

  register(adapter: ProfileAdapter): this {
    if (this.#adapters.has(adapter.profileId))
      throw new Error(
        `Profile adapter ${adapter.profileId} is already registered`,
      );
    this.#adapters.set(adapter.profileId, adapter);
    return this;
  }

  get(profileId: string): ProfileAdapter | undefined {
    return this.#adapters.get(profileId);
  }

  entries(): readonly ProfileAdapter[] {
    return [...this.#adapters.values()].sort((left, right) =>
      left.profileId.localeCompare(right.profileId),
    );
  }
}

export const baseProfileAdapter: ProfileAdapter = Object.freeze({
  profileId: "dstar:base",
  version: "0.1.0",
  supportedNodeTypes: new Set(["document", "heading", "paragraph", "image"]),
  supportedMarkTypes: new Set(["strong", "emphasis", "code", "link"]),
});

export function defaultProfileRegistry(): ProfileRegistry {
  return new ProfileRegistry().register(baseProfileAdapter);
}

function ownerProfile(type: string): string {
  const colon = type.indexOf(":");
  return colon === -1 ? "dstar:base" : type.slice(0, colon);
}

function makeNode(
  node: DstarNode,
  registry: ProfileRegistry,
  nodeOrder: string[],
  allRuns: CanonicalTextRunDescriptor[],
  diagnostics: Diagnostic[],
): RenderNode {
  nodeOrder.push(node.id);
  const adapter = registry.get(ownerProfile(node.type));
  const supported = adapter?.supportedNodeTypes.has(node.type) === true;
  if (!supported) {
    diagnostics.push(
      createDiagnostic("PROFILE_UNSUPPORTED", {
        severity: "warning",
        summary: `Node ${node.id} (${node.type}) has no installed complete renderer; a visible fallback was emitted.`,
        location: { objectId: node.id },
      }),
    );
  }
  const runs: CanonicalTextRunDescriptor[] = [];
  let offset = 0;
  for (const [index, inline] of (node.content ?? []).entries()) {
    const text = typeof inline.text === "string" ? inline.text : "";
    const length = [...text].length;
    const run = Object.freeze({
      id: `${node.id}:text:${index}`,
      nodeId: node.id,
      start: offset,
      end: offset + length,
      canonical: true as const,
      inline,
    });
    runs.push(run);
    allRuns.push(run);
    offset += length;
  }
  return Object.freeze({
    id: node.id,
    type: node.type,
    supported,
    node,
    text: nodeTextStream(node),
    textRuns: Object.freeze(runs),
    children: Object.freeze(
      (node.children ?? []).map((child) =>
        makeNode(child, registry, nodeOrder, allRuns, diagnostics),
      ),
    ),
  });
}

export function buildRenderTree(
  document: DstarDocument,
  profiles: readonly string[],
  registry = defaultProfileRegistry(),
): RenderTree {
  const nodeOrder: string[] = [];
  const textRuns: CanonicalTextRunDescriptor[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const profile of profiles) {
    if (!registry.get(profile))
      diagnostics.push(
        createDiagnostic("PROFILE_UNSUPPORTED", {
          severity: "warning",
          summary: `No renderer is installed for declared profile ${profile}.`,
        }),
      );
  }
  const root = makeNode(document, registry, nodeOrder, textRuns, diagnostics);
  return Object.freeze({
    root,
    nodeOrder: Object.freeze(nodeOrder),
    textRuns: Object.freeze(textRuns),
    diagnostics: Object.freeze(diagnostics),
    adapterVersions: Object.freeze(
      Object.fromEntries(
        registry
          .entries()
          .map((adapter) => [adapter.profileId, adapter.version]),
      ),
    ),
  });
}
