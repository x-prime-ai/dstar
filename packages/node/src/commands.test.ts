import {
  buildGenesisProposal,
  documentRevision,
  type DstarActor,
} from "@dstar/core";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PackageCommands,
  acceptGenesisDraft,
  createGenesisDraft,
  stageGenesisProposal,
} from "./commands.js";
import { PackageRepository, encodeJson } from "./repository.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);
const human: DstarActor = {
  type: "human",
  id: "human_test",
  name: "Test human",
};
const agent: DstarActor = {
  type: "agent",
  id: "agent_demo",
  name: "Demo agent",
};

async function workspace() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-commands-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  const runtimeRoot = join(temporary, "runtime");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  const repository = new PackageRepository(runtimeRoot);
  return {
    temporary,
    packageRoot,
    runtimeRoot,
    repository,
    commands: new PackageCommands(repository),
  };
}

describe("atomic package commands", () => {
  it("keeps human replies, resolution, cancellation, and decisions separate", async () => {
    const { packageRoot, repository, commands } = await workspace();
    const opened = await repository.open(packageRoot);
    const replied = await commands.addHumanReply(
      opened,
      {
        annotationId: "ann_0001",
        reply: {
          id: "reply_human_test",
          body: "Keep this discussion separate from assignment.",
          author: human,
          createdAt: "2026-08-26T09:00:00Z",
        },
      },
      {
        expectedSnapshotId: opened.snapshotId,
        idempotencyKey: "reply-human-test",
      },
    );
    const resolved = await commands.resolveAnnotation(
      replied,
      "ann_0001",
      human,
      "2026-08-26T09:01:00Z",
      {
        expectedSnapshotId: replied.snapshotId,
        idempotencyKey: "resolve-human-test",
      },
    );
    expect(resolved.annotations[0]).toMatchObject({
      status: "resolved",
      resolvedBy: human,
    });
    expect(resolved.delegations[0]?.status).toBe("completed");
    expect(
      resolved.changes.find((change) => change.id === "change_0001")?.status,
    ).toBe("proposed");

    const queued = await commands.createDelegation(
      resolved,
      {
        id: "delegation_cancel_test",
        annotationId: "ann_0001",
        assignee: agent,
        createdBy: human,
        createdAt: "2026-08-26T09:02:00Z",
      },
      {
        expectedSnapshotId: resolved.snapshotId,
        idempotencyKey: "queue-cancel-test",
      },
    );
    const cancelled = await commands.cancelDelegation(
      queued,
      "delegation_cancel_test",
      human,
      "2026-08-26T09:03:00Z",
      "No longer needed.",
      {
        expectedSnapshotId: queued.snapshotId,
        idempotencyKey: "cancel-human-test",
      },
    );
    expect(
      cancelled.delegations.find(
        (delegation) => delegation.id === "delegation_cancel_test",
      )?.status,
    ).toBe("cancelled");
    expect(cancelled.annotations[0]?.status).toBe("resolved");

    const superseded = await commands.supersedeChange(
      cancelled,
      "change_0001",
      human,
      "2026-08-26T09:04:00Z",
      "A new request will replace it.",
      {
        expectedSnapshotId: cancelled.snapshotId,
        idempotencyKey: "supersede-human-test",
      },
    );
    expect(
      superseded.changes.find((change) => change.id === "change_0001")?.status,
    ).toBe("superseded");
    expect(superseded.manifest.revision).toBe(opened.manifest.revision);
  });

  it("creates a delegation and records an agent proposal without accepting content", async () => {
    const { packageRoot, repository, commands } = await workspace();
    const opened = await repository.open(packageRoot);
    const delegated = await commands.createDelegation(
      opened,
      {
        id: "delegation_test",
        annotationId: "ann_0001",
        assignee: agent,
        createdBy: human,
        createdAt: "2026-08-26T10:00:00Z",
        instruction: "Propose a wording update.",
      },
      {
        expectedSnapshotId: opened.snapshotId,
        idempotencyKey: "create-delegation-test",
      },
    );
    const fixtureProposal = delegated.changes.find(
      (change) => change.id === "change_0001",
    )!;
    const proposal = {
      ...fixtureProposal,
      id: "change_test",
      idempotencyKey: "proposal-test",
      motivatedBy: ["ann_0001"],
      fulfills: ["delegation_test"],
    };
    const completed = await commands.recordProposalResult(
      delegated,
      {
        change: proposal,
        delegationId: "delegation_test",
        completedBy: agent,
        completedAt: "2026-08-26T10:01:00Z",
      },
      {
        expectedSnapshotId: delegated.snapshotId,
        idempotencyKey: "proposal-result-test",
      },
    );

    expect(
      completed.delegations.find((item) => item.id === "delegation_test")
        ?.status,
    ).toBe("completed");
    expect(
      completed.changes.find((item) => item.id === "change_test")?.status,
    ).toBe("proposed");
    expect(completed.manifest.headChange).toBe(opened.manifest.headChange);
    expect(completed.manifest.revision).toBe(opened.manifest.revision);
  });

  it("accepts only through a human decision and rebuilds history without runtime state", async () => {
    const { packageRoot, runtimeRoot, repository, commands } =
      await workspace();
    const opened = await repository.open(packageRoot);
    const simulation = commands.simulateChange(opened, "change_0001");
    expect(simulation.applicability).toBe("applicable");
    const accepted = await commands.acceptChange(
      opened,
      "change_0001",
      human,
      "2026-08-26T10:10:00Z",
      simulation.resultRevision!,
      {
        expectedSnapshotId: opened.snapshotId,
        idempotencyKey: "accept-change-test",
      },
    );
    expect(accepted.manifest.headChange).toBe("change_0001");
    expect(
      commands.history(accepted).map((version) => version.changeId),
    ).toEqual(["change_genesis_0001", "change_0001"]);

    await rm(runtimeRoot, { recursive: true, force: true });
    const reopened = await new PackageRepository(runtimeRoot).open(packageRoot);
    const materialized = new PackageCommands(
      new PackageRepository(runtimeRoot),
    ).showVersion(reopened, "change_0001");
    expect(materialized.valid).toBe(true);
    expect(materialized.revision).toBe(reopened.manifest.revision);
  });

  it("materializes an agent-authored genesis proposal only after human acceptance", async () => {
    const { temporary } = await workspace();
    const requestPath = join(temporary, "request.json");
    const draftRoot = join(temporary, "draft");
    const request = {
      output: "created.dstar",
      documentId: "document_created",
      title: "Created document",
      profiles: ["dstar:base"],
      actor: human,
      body: "Create the initial document.",
      createdAt: "2026-08-26T11:00:00Z",
    };
    await writeFile(requestPath, encodeJson(request));
    await createGenesisDraft(requestPath, draftRoot);
    const document = {
      id: "node_root_created",
      type: "document" as const,
      children: [
        {
          id: "node_paragraph_created",
          type: "paragraph" as const,
          content: [
            {
              type: "text" as const,
              text: "Agents author. Humans direct and decide.",
            },
          ],
        },
      ],
    };
    const proposal = buildGenesisProposal({
      id: "change_genesis_created",
      operationId: "operation_genesis_created",
      idempotencyKey: "genesis-created",
      author: agent,
      requestActor: human,
      requestBody: request.body,
      requestCreatedAt: request.createdAt,
      createdAt: "2026-08-26T11:01:00Z",
      document,
    });
    await stageGenesisProposal(draftRoot, proposal);
    const revision = documentRevision(document);
    const created = await acceptGenesisDraft(
      draftRoot,
      human,
      "2026-08-26T11:02:00Z",
      revision,
    );

    expect(created.root.endsWith("/created.dstar")).toBe(true);
    expect(created.manifest.revision).toBe(revision);
    expect(created.changes[0]?.decision?.actor.type).toBe("human");
  });
});
