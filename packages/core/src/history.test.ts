import { describe, expect, it } from "vitest";

import {
  acceptGenesisProposal,
  acceptUpdateChange,
  listCanonicalVersions,
  materializeVersion,
  rejectOrSupersedeChange,
  simulateUpdateChange,
} from "./history.js";
import { buildGenesisProposal } from "./builders.js";
import { simulateOperations } from "./operations.js";
import type {
  DstarActor,
  DstarChange,
  DstarDocument,
  DstarUpdateOperation,
  InMemoryPackage,
} from "./protocol.js";
import { documentRevision, nodeRevision } from "./revisions.js";

const service: DstarActor = { type: "service", id: "service_writer" };
const human: DstarActor = { type: "human", id: "human_reviewer" };
const createdAt = "2026-01-01T00:00:00.000Z";

function find(document: DstarDocument, id: string) {
  const stack = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.id === id) return node;
    stack.push(...(node?.children ?? []));
  }
  throw new Error(`Missing ${id}`);
}

function acceptedPackage(): InMemoryPackage {
  const genesisDocument: DstarDocument = {
    id: "doc",
    type: "document",
    children: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ type: "text", text: "A" }],
        "x-custom": { keep: true },
      },
    ],
  };
  const genesisRevision = documentRevision(genesisDocument);
  const firstOperation: DstarUpdateOperation = {
    id: "op_1",
    op: "replace_text",
    target: { node: "p1" },
    precondition: {
      nodeRevision: nodeRevision(find(genesisDocument, "p1")),
      expectedText: "A",
    },
    range: { start: 0, end: 1, unit: "unicode-code-point" },
    value: "B",
  };
  const firstResult = simulateOperations(genesisDocument, [
    firstOperation,
  ]).result!;
  const firstRevision = documentRevision(firstResult);
  const secondOperation: DstarUpdateOperation = {
    id: "op_2",
    op: "replace_text",
    target: { node: "p1" },
    precondition: {
      nodeRevision: nodeRevision(find(firstResult, "p1")),
      expectedText: "B",
    },
    range: { start: 0, end: 1, unit: "unicode-code-point" },
    value: "A",
  };
  const headDocument = simulateOperations(firstResult, [
    secondOperation,
  ]).result!;
  const headRevision = documentRevision(headDocument);

  const changes: DstarChange[] = [
    {
      id: "change_genesis",
      kind: "genesis",
      idempotencyKey: "genesis-key",
      author: service,
      request: { actor: human as never, body: "Create it", createdAt },
      operations: [
        { id: "op_genesis", op: "create_document", value: genesisDocument },
      ],
      status: "accepted",
      createdAt,
      decision: {
        status: "accepted",
        actor: human as never,
        at: createdAt,
        resultRevision: genesisRevision,
      },
    },
    {
      id: "change_1",
      kind: "update",
      idempotencyKey: "change-1-key",
      baseChange: "change_genesis",
      baseRevision: genesisRevision,
      author: service,
      operations: [firstOperation],
      status: "accepted",
      createdAt,
      decision: {
        status: "accepted",
        actor: human as never,
        at: createdAt,
        resultRevision: firstRevision,
      },
    },
    {
      id: "change_2",
      kind: "update",
      idempotencyKey: "change-2-key",
      baseChange: "change_1",
      baseRevision: firstRevision,
      author: service,
      operations: [secondOperation],
      status: "accepted",
      createdAt,
      decision: {
        status: "accepted",
        actor: human as never,
        at: createdAt,
        resultRevision: headRevision,
      },
    },
  ];

  return {
    manifest: {
      dstar: "0.1",
      id: "doc",
      revision: headRevision,
      headChange: "change_2",
      title: "History",
      profiles: ["dstar:base"],
      document: "document.json",
      changes: "changes",
    },
    document: headDocument,
    annotations: [],
    changes,
  };
}

describe("accepted canonical version materialization", () => {
  it("materializes genesis, intermediate, and head deterministically", () => {
    const pkg = acceptedPackage();
    expect(
      find(materializeVersion(pkg, "change_genesis").document!, "p1")
        .content?.[0]?.text,
    ).toBe("A");
    expect(
      find(materializeVersion(pkg, "change_1").document!, "p1").content?.[0]
        ?.text,
    ).toBe("B");
    expect(
      find(materializeVersion(pkg, "change_2").document!, "p1").content?.[0]
        ?.text,
    ).toBe("A");
    expect(materializeVersion(pkg, "change_2").valid).toBe(true);
  });

  it("keeps repeated content revisions as distinct versions and preserves extensions", () => {
    const pkg = acceptedPackage();
    const versions = listCanonicalVersions(pkg);
    expect(versions).toHaveLength(3);
    expect(versions[0]?.resultRevision).toBe(versions[2]?.resultRevision);
    expect(
      find(materializeVersion(pkg, "change_2").document!, "p1")["x-custom"],
    ).toEqual({ keep: true });
  });

  it("reports corrupted accepted history instead of substituting current content", () => {
    const pkg = acceptedPackage();
    const corrupted: InMemoryPackage = {
      ...pkg,
      changes: pkg.changes.map((change) =>
        change.id === "change_1"
          ? ({
              ...change,
              decision: {
                ...change.decision!,
                resultRevision: "sha256:" + "0".repeat(64),
              },
            } as DstarChange)
          : change,
      ),
    };
    const result = materializeVersion(corrupted, "change_2");
    expect(result.valid).toBe(false);
    expect(result.document).toBeUndefined();
  });
});

describe("pure change applier authority boundary", () => {
  it("materializes genesis only through an explicit human decision", () => {
    const document: DstarDocument = {
      id: "doc_genesis",
      type: "document",
      children: [
        {
          id: "p",
          type: "paragraph",
          content: [{ type: "text", text: "Created" }],
        },
      ],
    };
    const proposal = buildGenesisProposal({
      id: "genesis_proposal",
      operationId: "create_document",
      idempotencyKey: "genesis-proposal-key",
      author: human,
      requestActor: human,
      requestBody: "Create a document",
      createdAt,
      document,
    });
    const revision = documentRevision(document);
    expect(
      acceptGenesisProposal(
        proposal,
        {
          documentId: "doc_genesis",
          title: "Genesis",
          profiles: ["dstar:base"],
        },
        service,
        createdAt,
        revision,
      ).valid,
    ).toBe(false);
    const accepted = acceptGenesisProposal(
      proposal,
      { documentId: "doc_genesis", title: "Genesis", profiles: ["dstar:base"] },
      human,
      createdAt,
      revision,
    );
    expect(accepted.valid).toBe(true);
    expect(accepted.package?.manifest.headChange).toBe(proposal.id);
    expect(accepted.package?.changes[0]?.decision?.actor.type).toBe("human");
  });

  it("keeps proposals pending until a human accepts the exact simulation", () => {
    const pkg = acceptedPackage();
    const paragraph = find(pkg.document, "p1");
    const proposal: DstarChange = {
      id: "change_3",
      kind: "update",
      idempotencyKey: "change-3-key",
      baseChange: pkg.manifest.headChange,
      baseRevision: pkg.manifest.revision,
      author: human,
      operations: [
        {
          id: "op_3",
          op: "replace_text",
          target: { node: "p1" },
          precondition: {
            nodeRevision: nodeRevision(paragraph),
            expectedText: "A",
          },
          range: { start: 0, end: 1, unit: "unicode-code-point" },
          value: "C",
        },
      ],
      status: "proposed",
      createdAt,
    };
    const withProposal = { ...pkg, changes: [...pkg.changes, proposal] };
    const simulation = simulateUpdateChange(withProposal, proposal.id);
    expect(simulation.applicability).toBe("applicable");
    expect(proposal.status).toBe("proposed");

    const serviceAttempt = acceptUpdateChange(
      withProposal,
      proposal.id,
      service,
      createdAt,
      simulation.resultRevision!,
    );
    expect(serviceAttempt.valid).toBe(false);

    const humanDecision = acceptUpdateChange(
      withProposal,
      proposal.id,
      human,
      createdAt,
      simulation.resultRevision!,
    );
    expect(humanDecision.valid).toBe(true);
    expect(
      humanDecision.package?.changes.find((change) => change.id === proposal.id)
        ?.status,
    ).toBe("accepted");
    expect(find(humanDecision.package!.document, "p1").content?.[0]?.text).toBe(
      "C",
    );

    const rejected = rejectOrSupersedeChange(
      withProposal,
      proposal.id,
      "rejected",
      human,
      createdAt,
      "No",
    );
    expect(rejected.valid).toBe(true);
    expect(rejected.package?.document).toEqual(withProposal.document);
    expect(
      rejected.package?.changes.find((change) => change.id === proposal.id)
        ?.status,
    ).toBe("rejected");
  });
});
