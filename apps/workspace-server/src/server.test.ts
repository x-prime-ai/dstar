import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PackageRepository } from "@dstar/node";
import { afterEach, describe, expect, it } from "vitest";

import { startWorkspaceServer, type WorkspaceServerHandle } from "./server.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);
const servers: WorkspaceServerHandle[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function workspace() {
  const temporary = await mkdtemp(
    join(tmpdir(), "dstar-workspace-server-test-"),
  );
  const packageRoot = join(temporary, "fixture.dstar");
  const webRoot = join(temporary, "web");
  await Promise.all([
    cp(fixtureRoot, packageRoot, { recursive: true }),
    mkdir(webRoot, { recursive: true }),
  ]);
  await writeFile(
    join(webRoot, "index.html"),
    "<!doctype html><title>DSTAR</title>",
  );
  let nextId = 0;
  const server = await startWorkspaceServer({
    packageRoot,
    runtimeRoot: join(temporary, "runtime"),
    human: { type: "human", id: "human_review_test" },
    webRoot,
    now: () => "2026-08-26T12:00:00Z",
    id: (prefix) => `${prefix}_server_${++nextId}`,
  });
  servers.push(server);
  return { packageRoot, server };
}

function headers(server: WorkspaceServerHandle, mutation = false) {
  return {
    Authorization: `Bearer ${server.token}`,
    Origin: server.origin,
    ...(mutation
      ? {
          "Content-Type": "application/json",
          "X-DSTAR-CSRF": server.csrfToken,
        }
      : {}),
  };
}

async function api(server: WorkspaceServerHandle, path: string) {
  return fetch(`${server.origin}/api/v1${path}`, { headers: headers(server) });
}

async function mutate(
  server: WorkspaceServerHandle,
  path: string,
  body: Record<string, unknown>,
) {
  return fetch(`${server.origin}/api/v1${path}`, {
    method: "POST",
    headers: headers(server, true),
    body: JSON.stringify(body),
  });
}

describe("loopback workspace server", () => {
  it("serves only an inert shell without auth and protects every API request", async () => {
    const { server } = await workspace();
    expect(await (await fetch(server.origin)).text()).toContain("DSTAR");
    expect((await fetch(`${server.origin}/api/v1/snapshot`)).status).toBe(401);
    expect(
      (
        await fetch(`${server.origin}/api/v1/snapshot`, {
          headers: {
            Authorization: `Bearer ${server.token}`,
            Origin: "https://attacker.example",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${server.origin}/api/v1/snapshot`, {
          headers: { ...headers(server), Cookie: "session=ambient" },
        })
      ).status,
    ).toBe(401);
    expect((await api(server, "/snapshot")).status).toBe(200);
    const document = await (await api(server, "/document")).json();
    expect(document.html).toContain('data-dstar-node="node_promise"');
    expect(document.html).not.toContain("contenteditable");
  });

  it("persists comments, replies, resolution, and delegation as separate commands", async () => {
    const { packageRoot, server } = await workspace();
    const snapshot = await (await api(server, "/snapshot")).json();
    const command = {
      expectedSnapshotId: snapshot.snapshotId,
      idempotencyKey: "server-create-comment",
      purpose: "change-request",
      scope: "canonical",
      target: {
        source: "document",
        revision: snapshot.manifest.revision,
        selector: {
          type: "NodeSelector",
          node: "node_promise",
          refinedBy: [
            {
              type: "TextPositionSelector",
              start: 0,
              end: 6,
              unit: "unicode-code-point",
            },
            { type: "TextQuoteSelector", exact: "Agents" },
          ],
        },
      },
      body: "Make the agent boundary even clearer.",
      audience: ["human", "agent"],
    };
    expect(
      (
        await fetch(`${server.origin}/api/v1/annotations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${server.token}`,
            Origin: server.origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(403);
    const createdResponse = await mutate(server, "/annotations", command);
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    const annotations = await (await api(server, "/annotations")).json();
    const annotationId = annotations.find(
      (item: { annotation: { body: string } }) =>
        item.annotation.body === command.body,
    ).annotation.id;

    const repliedResponse = await mutate(
      server,
      `/annotations/${annotationId}/replies`,
      {
        expectedSnapshotId: created.snapshotId,
        idempotencyKey: "server-reply-comment",
        body: "This is a direct human reply.",
      },
    );
    const replied = await repliedResponse.json();
    expect(repliedResponse.status).toBe(200);

    const delegatedResponse = await mutate(server, "/delegations", {
      expectedSnapshotId: replied.snapshotId,
      idempotencyKey: "server-delegate-comment",
      annotationId,
      assigneeId: "agent_demo",
      instruction: "Propose a focused change.",
    });
    const delegated = await delegatedResponse.json();
    expect(delegatedResponse.status).toBe(200);

    const resolvedResponse = await mutate(
      server,
      `/annotations/${annotationId}/resolve`,
      {
        expectedSnapshotId: delegated.snapshotId,
        idempotencyKey: "server-resolve-comment",
      },
    );
    expect(resolvedResponse.status).toBe(200);
    const finalAnnotations = await (await api(server, "/annotations")).json();
    const finalDelegations = await (await api(server, "/delegations")).json();
    expect(
      finalAnnotations.find(
        (item: { annotation: { id: string } }) =>
          item.annotation.id === annotationId,
      ).annotation,
    ).toMatchObject({
      status: "resolved",
      replies: [
        expect.objectContaining({
          author: expect.objectContaining({ type: "human" }),
        }),
      ],
    });
    expect(
      finalDelegations.find(
        (delegation: { annotation: string }) =>
          delegation.annotation === annotationId,
      ),
    ).toMatchObject({ status: "queued", assignee: { type: "agent" } });
    const reopened = await new PackageRepository(
      join(packageRoot, "..", "reopen-runtime"),
    ).open(packageRoot);
    expect(
      reopened.annotations.find((annotation) => annotation.id === annotationId),
    ).toMatchObject({ status: "resolved" });
    expect(
      reopened.delegations.some(
        (delegation) => delegation.annotation === annotationId,
      ),
    ).toBe(true);
  });

  it("shows deterministic simulation and requires the current result revision for human acceptance", async () => {
    const { server } = await workspace();
    const snapshot = await (await api(server, "/snapshot")).json();
    const simulation = await (
      await api(server, "/changes/change_0001/simulation")
    ).json();
    expect(simulation).toMatchObject({
      applicability: "applicable",
      beforeHtml: expect.stringContaining("Agents author"),
      afterHtml: expect.stringContaining("Humans direct, review, and decide"),
    });
    const rejected = await mutate(server, "/changes/change_0001/accept", {
      expectedSnapshotId: snapshot.snapshotId,
      idempotencyKey: "server-accept-wrong",
      expectedResultRevision: snapshot.manifest.revision,
    });
    expect(rejected.status).toBe(422);

    const current = await (await api(server, "/snapshot")).json();
    const accepted = await mutate(server, "/changes/change_0001/accept", {
      expectedSnapshotId: current.snapshotId,
      idempotencyKey: "server-accept-correct",
      expectedResultRevision: simulation.resultRevision,
    });
    expect(accepted.status).toBe(200);
    const after = await (await api(server, "/snapshot")).json();
    expect(after.manifest.revision).toBe(simulation.resultRevision);
    expect(after.manifest.headChange).toBe("change_0001");
    expect(
      after.projections.every(
        (projection: { fresh: boolean }) => !projection.fresh,
      ),
    ).toBe(true);
    const historical = await (
      await api(server, "/versions/change_0001/document")
    ).json();
    expect(historical).toMatchObject({
      changeId: "change_0001",
      revision: simulation.resultRevision,
      historical: true,
      html: expect.stringContaining("Humans direct, review, and decide"),
    });
    expect(historical.html).not.toContain("contenteditable");
  });
});
