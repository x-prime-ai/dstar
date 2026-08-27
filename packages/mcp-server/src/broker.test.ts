import {
  documentRevision,
  type DstarActor,
  type DstarChange,
} from "@dstar/core";
import { PackageRepository, createGenesisDraft, encodeJson } from "@dstar/node";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DstarMcpBroker, type McpBrokerError } from "./broker.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);
const principal: DstarActor = { type: "human", id: "human_demo" };

async function documentWorkspace() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-mcp-broker-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  const runtimeRoot = join(temporary, "runtime");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  return {
    temporary,
    packageRoot,
    runtimeRoot,
    repository: new PackageRepository(runtimeRoot),
  };
}

describe("document-scoped DSTAR MCP broker", () => {
  it("reads one document and records a proposal on behalf of its human principal", async () => {
    const { packageRoot, runtimeRoot, repository } = await documentWorkspace();
    const broker = await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      principalId: principal.id,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const before = await repository.open(packageRoot);
    const listed = (await broker.listComments(true, true)) as Record<
      string,
      unknown
    >;
    expect(listed.comments).toEqual([
      expect.objectContaining({
        id: "ann_0001",
        assignee: expect.objectContaining({ id: principal.id }),
      }),
    ]);
    await expect(broker.getAnnotation("ann_0001")).resolves.toMatchObject({
      annotation: { assignee: principal },
    });
    await expect(broker.searchDocument("Humans review")).resolves.toMatchObject(
      { results: [expect.objectContaining({ nodeId: "node_promise" })] },
    );

    const operation = {
      ...before.changes.find((change) => change.id === "change_0001")!
        .operations[0],
      id: "operation_mcp_proposal",
    };
    const input = {
      idempotencyKey: "mcp-proposal-1",
      baseChange: before.manifest.headChange,
      baseRevision: before.manifest.revision,
      operations: [operation],
      motivatedBy: ["ann_0001"],
      sourceIds: ["source_dstar_spec"],
    };
    await expect(broker.simulateUpdate(input)).resolves.toMatchObject({
      simulation: { applicability: "applicable" },
    });
    const submitted = (await broker.submitProposal(input)) as Record<
      string,
      unknown
    >;
    expect(submitted).toMatchObject({
      status: "pending-human-decision",
      canonicalRevision: before.manifest.revision,
    });
    await expect(broker.submitProposal(input)).resolves.toMatchObject({
      changeId: submitted.changeId,
    });
    await expect(
      broker.submitProposal({ ...input, sourceIds: [] }),
    ).rejects.toMatchObject<McpBrokerError>({ code: "IDEMPOTENCY_MISMATCH" });

    const after = await repository.open(packageRoot);
    const proposal = after.changes.find(
      (change) => change.id === submitted.changeId,
    );
    expect(proposal).toMatchObject({ status: "proposed", author: principal });
    expect(after.manifest.headChange).toBe(before.manifest.headChange);
    expect(after.manifest.revision).toBe(before.manifest.revision);
  });

  it("records idempotent replies on behalf of the human principal", async () => {
    const { packageRoot, runtimeRoot, repository } = await documentWorkspace();
    const broker = await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      principalId: principal.id,
    });
    const input = {
      annotationId: "ann_0001",
      body: "Prepared a proposal for review.",
      idempotencyKey: "reply-1",
    };
    const first = (await broker.replyComment(input)) as Record<string, unknown>;
    await expect(broker.replyComment(input)).resolves.toMatchObject({
      replyId: first.replyId,
    });
    await expect(
      broker.replyComment({ ...input, body: "Different reply." }),
    ).rejects.toMatchObject<McpBrokerError>({ code: "IDEMPOTENCY_MISMATCH" });
    const annotation = (await repository.open(packageRoot)).annotations.find(
      (item) => item.id === "ann_0001",
    )!;
    expect(annotation.replies).toEqual([
      expect.objectContaining({ id: first.replyId, author: principal }),
    ]);
  });

  it("enforces cancellation, session budgets, expiry, and resource scope", async () => {
    const { packageRoot, runtimeRoot } = await documentWorkspace();
    let now = new Date("2026-08-26T12:00:00Z");
    const broker = await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      principalId: principal.id,
      expiresAt: "2026-08-26T12:01:00Z",
      now: () => now,
      budgets: { maxCalls: 2 },
    });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      broker.getManifest(cancelled.signal),
    ).rejects.toMatchObject<McpBrokerError>({ code: "CANCELLED" });
    await broker.getManifest();
    await expect(
      broker.readResource("file:///etc/passwd"),
    ).rejects.toMatchObject<McpBrokerError>({ code: "CAPABILITY_DENIED" });
    await expect(broker.getManifest()).rejects.toMatchObject<McpBrokerError>({
      code: "BUDGET_EXCEEDED",
    });
    now = new Date("2026-08-26T12:02:00Z");
    await expect(broker.getManifest()).rejects.toMatchObject<McpBrokerError>({
      code: "CAPABILITY_EXPIRED",
    });
  });

  it("stages an idempotent genesis proposal without creating canonical content", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "dstar-mcp-genesis-test-"));
    const requestFile = join(temporary, "request.json");
    const draftRoot = join(temporary, "draft");
    await writeFile(
      requestFile,
      encodeJson({
        output: "created.dstar",
        documentId: "document_mcp",
        title: "MCP genesis",
        profiles: ["dstar:base"],
        actor: principal,
        body: "Create an initial document.",
        createdAt: "2026-08-26T13:00:00Z",
      }),
    );
    await createGenesisDraft(requestFile, draftRoot);
    const broker = await DstarMcpBroker.create({
      mode: "genesis",
      draftRoot,
      principalId: principal.id,
      now: () => new Date("2026-08-26T13:01:00Z"),
    });
    const document = {
      id: "node_genesis_root",
      type: "document",
      children: [
        {
          id: "node_genesis_paragraph",
          type: "paragraph",
          content: [
            { type: "text", text: "Tools propose. Humans review and decide." },
          ],
        },
      ],
    };
    const input = { idempotencyKey: "genesis-result", document };
    await expect(broker.submitGenesis(input)).resolves.toMatchObject({
      status: "pending-human-decision",
      documentRevision: documentRevision(document),
    });
    await expect(broker.submitGenesis(input)).resolves.toMatchObject({
      status: "pending-human-decision",
    });
    await expect(
      broker.submitGenesis({
        ...input,
        document: { ...document, children: [] },
      }),
    ).rejects.toMatchObject<McpBrokerError>({ code: "IDEMPOTENCY_MISMATCH" });
    const proposal = JSON.parse(
      await readFile(join(draftRoot, "proposal.json"), "utf8"),
    ) as DstarChange;
    expect(proposal).toMatchObject({ status: "proposed", author: principal });
    await expect(
      readFile(join(temporary, "created.dstar", "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
