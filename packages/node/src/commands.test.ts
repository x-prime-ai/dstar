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
  it("keeps human replies, assignment, resolution, and decisions separate", async () => {
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
    expect(resolved.annotations[0]?.assignee?.type).toBe("human");
    expect(
      resolved.changes.find((change) => change.id === "change_0001")?.status,
    ).toBe("proposed");

    const assigned = await commands.assignAnnotation(
      resolved,
      "ann_0001",
      { type: "human", id: "human_assignee" },
      {
        expectedSnapshotId: resolved.snapshotId,
        idempotencyKey: "assign-human-test",
      },
    );
    expect(assigned.annotations[0]?.assignee?.id).toBe("human_assignee");
    expect(assigned.annotations[0]?.status).toBe("resolved");
    await expect(
      commands.assignAnnotation(
        assigned,
        "ann_0001",
        { type: "service", id: "service_executor" },
        {
          expectedSnapshotId: assigned.snapshotId,
          idempotencyKey: "assign-service-test",
        },
      ),
    ).rejects.toThrow("Annotation assignee must be human");

    const superseded = await commands.supersedeChange(
      assigned,
      "change_0001",
      human,
      "2026-08-26T09:04:00Z",
      "A new request will replace it.",
      {
        expectedSnapshotId: assigned.snapshotId,
        idempotencyKey: "supersede-human-test",
      },
    );
    expect(
      superseded.changes.find((change) => change.id === "change_0001")?.status,
    ).toBe("superseded");
    expect(superseded.manifest.revision).toBe(opened.manifest.revision);
  });

  it("records a proposal directly without accepting content", async () => {
    const { packageRoot, repository, commands } = await workspace();
    const opened = await repository.open(packageRoot);
    const fixtureProposal = opened.changes.find(
      (change) => change.id === "change_0001",
    )!;
    const proposal = {
      ...fixtureProposal,
      id: "change_test",
      idempotencyKey: "proposal-test",
      motivatedBy: ["ann_0001"],
      author: human,
    };
    const completed = await commands.recordProposal(
      opened,
      {
        change: proposal,
      },
      {
        expectedSnapshotId: opened.snapshotId,
        idempotencyKey: "proposal-test",
      },
    );
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

  it("materializes a genesis proposal only after human acceptance", async () => {
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
              text: "Tools propose. Humans review and decide.",
            },
          ],
        },
      ],
    };
    const proposal = buildGenesisProposal({
      id: "change_genesis_created",
      operationId: "operation_genesis_created",
      idempotencyKey: "genesis-created",
      author: human,
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
