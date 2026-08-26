import {
  documentRevision,
  type DstarActor,
  type buildGenesisProposal,
} from "@dstar/core";
import {
  PackageCommands,
  PackageRepository,
  createGenesisDraft,
  encodeJson,
} from "@dstar/node";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DstarMcpBroker, type McpBrokerError } from "./broker.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);
const human: DstarActor = { type: "human", id: "human_mcp" };
const agent: DstarActor = { type: "agent", id: "agent_demo" };

async function documentWorkspace() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-mcp-broker-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  const runtimeRoot = join(temporary, "runtime");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  const repository = new PackageRepository(runtimeRoot);
  const commands = new PackageCommands(repository);
  let snapshot = await repository.open(packageRoot);
  const visible = await commands.createDelegation(
    snapshot,
    {
      id: "delegation_mcp_visible",
      annotationId: "ann_0001",
      assignee: agent,
      createdBy: human,
      createdAt: "2026-08-26T12:00:00Z",
      instruction: "Propose the requested clarification.",
    },
    {
      expectedSnapshotId: snapshot.snapshotId,
      idempotencyKey: "mcp-visible-delegation",
    },
  );
  const sourceAnnotation = visible.annotations.find(
    (annotation) => annotation.id === "ann_0001",
  )!;
  snapshot = await commands.createAnnotation(
    visible,
    {
      id: "ann_mcp_hidden",
      purpose: "discussion",
      scope: sourceAnnotation.scope,
      target: sourceAnnotation.target,
      canonicalTargets: sourceAnnotation.canonicalTargets,
      body: "Human-only context",
      author: human,
      createdAt: "2026-08-26T12:00:01Z",
      audience: ["human"],
    },
    {
      expectedSnapshotId: visible.snapshotId,
      idempotencyKey: "mcp-hidden-annotation",
    },
  );
  snapshot = await commands.createDelegation(
    snapshot,
    {
      id: "delegation_mcp_hidden",
      annotationId: "ann_mcp_hidden",
      assignee: agent,
      createdBy: human,
      createdAt: "2026-08-26T12:00:02Z",
    },
    {
      expectedSnapshotId: snapshot.snapshotId,
      idempotencyKey: "mcp-hidden-delegation",
    },
  );
  snapshot = await commands.createDelegation(
    snapshot,
    {
      id: "delegation_mcp_other_actor",
      annotationId: "ann_0001",
      assignee: { type: "agent", id: "agent_other" },
      createdBy: human,
      createdAt: "2026-08-26T12:00:03Z",
    },
    {
      expectedSnapshotId: snapshot.snapshotId,
      idempotencyKey: "mcp-other-delegation",
    },
  );
  return {
    temporary,
    packageRoot,
    runtimeRoot,
    repository,
    commands,
    snapshot,
  };
}

describe("scoped DSTAR MCP broker", () => {
  it("filters tasks by assignment and audience, then submits only a pending proposal", async () => {
    const { packageRoot, runtimeRoot, repository, commands } =
      await documentWorkspace();
    const broker = await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      actorId: "agent_demo",
      now: () => new Date("2026-08-26T12:10:00Z"),
      token: () => "opaque-task-token",
    });
    await expect(broker.listTasks()).resolves.toEqual([
      expect.objectContaining({
        delegationId: "delegation_mcp_visible",
        annotationId: "ann_0001",
      }),
    ]);
    await expect(
      broker.startTask("delegation_mcp_hidden"),
    ).rejects.toMatchObject<McpBrokerError>({
      code: "CAPABILITY_DENIED",
    });

    const started = (await broker.startTask(
      "delegation_mcp_visible",
    )) as Record<string, unknown>;
    const token = started.taskToken as string;
    await expect(
      broker.getAnnotation(token, "ann_mcp_hidden"),
    ).rejects.toMatchObject<McpBrokerError>({
      code: "CAPABILITY_DENIED",
    });
    const annotation = (await broker.getAnnotation(
      token,
      "ann_0001",
    )) as Record<string, unknown>;
    expect((annotation.annotation as { body: string }).body).toContain(
      "distinction",
    );

    const beforeExternalChange = await repository.open(packageRoot);
    await commands.createAnnotation(
      beforeExternalChange,
      {
        id: "ann_after_task_start",
        purpose: "discussion",
        scope: "canonical",
        target: {
          source: "document",
          revision: beforeExternalChange.manifest.revision,
          selector: { type: "NodeSelector", node: "node_promise" },
        },
        body: "Created after the task started.",
        author: human,
        createdAt: "2026-08-26T12:11:00Z",
      },
      {
        expectedSnapshotId: beforeExternalChange.snapshotId,
        idempotencyKey: "after-task-start",
      },
    );

    const operations = (await repository.open(packageRoot)).changes.find(
      (change) => change.id === "change_0001",
    )!.operations;
    const submitted = (await broker.submitResult(token, {
      idempotencyKey: "mcp-terminal-1",
      operations,
      sourceIds: ["source_dstar_spec"],
      replyBody: "I prepared a proposal for human review.",
    })) as Record<string, unknown>;
    expect(submitted).toMatchObject({
      status: "pending-human-decision",
      staleFromStartingSnapshot: true,
      canonicalHead: "change_genesis_0001",
    });
    const repeated = await broker.submitResult(token, {
      idempotencyKey: "mcp-terminal-1",
      operations,
      sourceIds: ["source_dstar_spec"],
      replyBody: "I prepared a proposal for human review.",
    });
    expect(repeated).toEqual(submitted);
    await expect(
      broker.submitResult(token, {
        idempotencyKey: "mcp-terminal-1",
        reason: "different",
      }),
    ).rejects.toMatchObject<McpBrokerError>({ code: "IDEMPOTENCY_MISMATCH" });

    const final = await repository.open(packageRoot);
    const change = final.changes.find(
      (candidate) => candidate.id === submitted.changeId,
    );
    expect(change?.status).toBe("proposed");
    expect(final.manifest.headChange).toBe("change_genesis_0001");
    expect(final.manifest.revision).toBe(
      beforeExternalChange.manifest.revision,
    );
    expect(
      final.changes.filter(
        (candidate) => candidate.idempotencyKey === "mcp-terminal-1",
      ),
    ).toHaveLength(1);
    expect(
      final.annotations
        .find((candidate) => candidate.id === "ann_0001")
        ?.replies?.filter(
          (reply) => reply.body === "I prepared a proposal for human review.",
        ),
    ).toHaveLength(1);
  });

  it("enforces cancellation, call budgets, and task expiry", async () => {
    const { packageRoot, runtimeRoot, repository } = await documentWorkspace();
    let now = new Date("2026-08-26T12:20:00Z");
    const broker = await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      actorId: "agent_demo",
      now: () => now,
      token: () => "limited-task-token",
      taskTtlMs: 1_000,
      budgets: { maxCalls: 1 },
    });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      broker.listTasks(cancelled.signal),
    ).rejects.toMatchObject<McpBrokerError>({ code: "CANCELLED" });
    const started = (await broker.startTask(
      "delegation_mcp_visible",
    )) as Record<string, unknown>;
    const token = started.taskToken as string;
    await broker.getManifest(token);
    await expect(broker.getTask(token)).rejects.toMatchObject<McpBrokerError>({
      code: "BUDGET_EXCEEDED",
    });
    now = new Date("2026-08-26T12:20:02Z");
    await expect(broker.getTask(token)).rejects.toMatchObject<McpBrokerError>({
      code: "CAPABILITY_EXPIRED",
    });

    const effectLimited = await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      actorId: "agent_demo",
      token: () => "effect-limited-token",
      budgets: { maxReadBytes: 1 },
    });
    const effectTask = (await effectLimited.startTask(
      "delegation_mcp_visible",
    )) as Record<string, unknown>;
    await expect(
      effectLimited.submitResult(effectTask.taskToken as string, {
        idempotencyKey: "must-not-write",
        reason: "No valid proposal.",
      }),
    ).rejects.toMatchObject<McpBrokerError>({ code: "BUDGET_EXCEEDED" });
    expect(
      (await repository.open(packageRoot)).delegations.find(
        (candidate) => candidate.id === "delegation_mcp_visible",
      )?.status,
    ).toBe("queued");
  });

  it("stages genesis as an agent proposal without materializing a package", async () => {
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
        actor: human,
        body: "Create an initial document.",
        createdAt: "2026-08-26T13:00:00Z",
      }),
    );
    await createGenesisDraft(requestFile, draftRoot);
    const broker = await DstarMcpBroker.create({
      mode: "genesis",
      draftRoot,
      actorId: "agent_demo",
      now: () => new Date("2026-08-26T13:01:00Z"),
      token: () => "genesis-task-token",
    });
    const started = (await broker.startTask()) as Record<string, unknown>;
    const document = {
      id: "node_genesis_root",
      type: "document",
      children: [
        {
          id: "node_genesis_paragraph",
          type: "paragraph",
          content: [
            { type: "text", text: "Agents author. Humans direct and decide." },
          ],
        },
      ],
    };
    const submitted = await broker.submitGenesis(started.taskToken as string, {
      idempotencyKey: "mcp-genesis-result",
      document,
    });
    expect(submitted).toMatchObject({
      status: "pending-human-decision",
      documentRevision: documentRevision(document),
    });
    const proposal = JSON.parse(
      await readFile(join(draftRoot, "proposal.json"), "utf8"),
    ) as ReturnType<typeof buildGenesisProposal>;
    expect(proposal.status).toBe("proposed");
    expect(proposal.author).toEqual(agent);
    await expect(
      readFile(join(temporary, "created.dstar", "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
