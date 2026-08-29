import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { decisions } from "@dstar/engine/decisions";
import { open } from "@dstar/engine";
import { afterEach, describe, expect, it } from "vitest";

import { startWorkspaceService } from "./server.mjs";

const cleanup = [];
afterEach(async () => {
  for (const item of cleanup.splice(0).reverse()) {
    if (typeof item === "string")
      rmSync(item, { recursive: true, force: true });
    else await item.close();
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dstar-workspace-service-"));
  cleanup.push(root);
  const candidate = join(root, "candidate");
  const seedRoot = join(root, "seed.dstar");
  mkdirSync(candidate);
  writeFileSync(
    join(candidate, "document.html"),
    '<!doctype html><html><head><title>Seed review</title></head><body><p data-dstar-id="intro">Seed text</p></body></html>',
  );
  const engine = open(seedRoot);
  const proposal = engine.propose({
    candidate,
    base: null,
    request: "Initial seed",
    author: "seed-builder",
    key: randomUUID(),
  });
  const state = engine.snapshot();
  decisions(seedRoot).decide(
    proposal.id,
    "accept",
    proposal.revision,
    state.stateId,
    "seed-builder",
  );
  return { root, seedRoot, proposal };
}

function wire(
  service,
  host,
  path,
  { method = "GET", token, origin, body } = {},
) {
  return new Promise((resolve, reject) => {
    const address = service.server.address();
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        method,
        agent: false,
        headers: {
          Host: host,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function serviceFixture(extra = {}) {
  const fixtureValue = fixture();
  const service = await startWorkspaceService({
    root: join(fixtureValue.root, "runtime"),
    seedRoot: fixtureValue.seedRoot,
    externalOrigin: "https://manage.review.test",
    workspaceDomain: "review.test",
    creationToken: "c".repeat(64),
    cleanupIntervalMs: 60_000,
    ...extra,
  });
  cleanup.push(service);
  return { ...fixtureValue, service };
}

async function create(service) {
  const response = await wire(
    service,
    "manage.review.test",
    "/api/v1/workspaces",
    {
      method: "POST",
      token: "c".repeat(64),
      origin: "https://manage.review.test",
      body: "{}",
    },
  );
  expect(response.status, response.text).toBe(201);
  return response.json();
}

function access(result) {
  const url = new URL(result.sessions.ownerUrl);
  return { host: url.host, origin: url.origin, token: url.hash.slice(1) };
}

describe("online workspace service", () => {
  it("creates isolated viewers and never crosses tokens, state, previews, or handoffs", async () => {
    const managementUrls = [];
    const { service, proposal } = await serviceFixture({
      sessionAdapter: {
        start({ viewerOptions, workspaceManagementUrl }) {
          managementUrls.push(workspaceManagementUrl);
          return viewerOptions;
        },
      },
    });
    const first = await create(service);
    const second = await create(service);
    const one = access(first);
    const two = access(second);
    expect(first.workspace.id).not.toBe(second.workspace.id);
    expect(one.token).not.toBe(two.token);
    expect(managementUrls).toEqual([first.manageUrl, second.manageUrl]);

    const oneState = await wire(service, one.host, "/api/state", {
      token: one.token,
    });
    const twoState = await wire(service, two.host, "/api/state", {
      token: two.token,
    });
    expect(oneState.status).toBe(200);
    expect(twoState.status).toBe(200);
    expect(
      (await wire(service, two.host, "/api/state", { token: one.token }))
        .status,
    ).toBe(401);
    const state = oneState.json();
    const target = {
      revision: state.revision,
      element: "intro",
      selector: {
        type: "text-range",
        start: 0,
        end: 4,
        unit: "unicode-code-point",
        exact: "Seed",
      },
    };
    expect(
      (
        await wire(service, one.host, "/api/comments", {
          method: "POST",
          token: one.token,
          origin: one.origin,
          body: JSON.stringify({ target, body: "Workspace one only" }),
        })
      ).status,
    ).toBe(201);
    expect(
      (await wire(service, one.host, "/api/state", { token: one.token })).json()
        .state.comments,
    ).toHaveLength(1);
    expect(
      (await wire(service, two.host, "/api/state", { token: two.token })).json()
        .state.comments,
    ).toHaveLength(0);

    const preview = (
      await wire(service, one.host, `/api/preview/${proposal.id}`, {
        token: one.token,
      })
    ).json();
    expect((await wire(service, one.host, preview.url)).status).toBe(200);
    expect((await wire(service, two.host, preview.url)).status).toBe(404);

    const handoffId = "11111111-1111-4111-8111-111111111111";
    const handoffToken = "h".repeat(64);
    const handoff = await wire(service, one.host, "/api/handoffs", {
      method: "POST",
      token: one.token,
      origin: one.origin,
      body: JSON.stringify({
        id: handoffId,
        accessToken: handoffToken,
        context: {
          selection: target,
          action: { kind: "comment", target, draft: "" },
          review: {
            revision: target.revision,
            proposalId: proposal.id,
            showingBase: false,
            previewStatus: "ready",
          },
        },
      }),
    });
    expect(handoff.status).toBe(201);
    expect(
      (await wire(service, one.host, "/api/state", { token: handoffToken }))
        .status,
    ).toBe(200);
    expect(
      (await wire(service, two.host, "/api/state", { token: handoffToken }))
        .status,
    ).toBe(401);
  });

  it("drains reset, rotates links and capabilities, and restores the seed", async () => {
    const { service, proposal } = await serviceFixture();
    const created = await create(service);
    const old = access(created);
    const state = (
      await wire(service, old.host, "/api/state", { token: old.token })
    ).json();
    const preview = (
      await wire(service, old.host, `/api/preview/${proposal.id}`, {
        token: old.token,
      })
    ).json();
    const target = {
      revision: state.revision,
      element: "intro",
      selector: {
        type: "text-range",
        start: 0,
        end: 4,
        unit: "unicode-code-point",
        exact: "Seed",
      },
    };
    const comment = await wire(service, old.host, "/api/comments", {
      method: "POST",
      token: old.token,
      origin: old.origin,
      body: JSON.stringify({
        body: "Will be reset",
        target,
      }),
    });
    expect(comment.status).toBe(201);
    const handoffId = "22222222-2222-4222-8222-222222222222";
    const handoffToken = "j".repeat(64);
    expect(
      (
        await wire(service, old.host, "/api/handoffs", {
          method: "POST",
          token: old.token,
          origin: old.origin,
          body: JSON.stringify({
            id: handoffId,
            accessToken: handoffToken,
            context: {
              selection: target,
              action: { kind: "comment", target, draft: "" },
              review: {
                revision: target.revision,
                proposalId: proposal.id,
                showingBase: false,
                previewStatus: "ready",
              },
            },
          }),
        })
      ).status,
    ).toBe(201);

    const [first, raced] = await Promise.all([
      wire(
        service,
        "manage.review.test",
        `/api/v1/workspaces/${created.workspace.id}/reset`,
        {
          method: "POST",
          token: old.token,
          origin: "https://manage.review.test",
          body: "{}",
        },
      ),
      wire(
        service,
        "manage.review.test",
        `/api/v1/workspaces/${created.workspace.id}/reset`,
        {
          method: "POST",
          token: old.token,
          origin: "https://manage.review.test",
          body: "{}",
        },
      ),
    ]);
    const successful = [first, raced].find(
      (response) => response.status === 200,
    );
    expect([first.status, raced.status]).toContain(200);
    expect(
      [first.status, raced.status].some((status) =>
        [401, 503].includes(status),
      ),
    ).toBe(true);
    const reset = successful.json();
    const next = access(reset);
    expect(reset.workspace.generation).toBe(2);
    expect(next.origin).toBe(old.origin);
    expect(next.token).not.toBe(old.token);
    expect(
      (await wire(service, old.host, "/api/state", { token: old.token }))
        .status,
    ).toBe(401);
    expect((await wire(service, next.host, preview.url)).status).toBe(404);
    for (const [method, path] of [
      ["GET", `/api/handoffs/${handoffId}`],
      ["POST", `/api/handoffs/${handoffId}/reply-draft`],
      ["POST", `/api/handoffs/${handoffId}/revoke`],
    ])
      expect(
        (
          await wire(service, next.host, path, {
            method,
            token: handoffToken,
            origin: next.origin,
            ...(method === "POST" ? { body: "{}" } : {}),
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await wire(service, next.host, "/api/state", { token: next.token })
      ).json().state.comments,
    ).toHaveLength(0);
  });

  it("survives restart with stable ids/links and rejects Host, Origin, and path selection", async () => {
    const fixtureValue = fixture();
    const options = {
      root: join(fixtureValue.root, "runtime"),
      seedRoot: fixtureValue.seedRoot,
      externalOrigin: "https://manage.review.test",
      workspaceDomain: "review.test",
      creationToken: "c".repeat(64),
      cleanupIntervalMs: 60_000,
    };
    let service = await startWorkspaceService(options);
    const created = await create(service);
    const owner = access(created);
    await expect(startWorkspaceService(options)).rejects.toThrow(
      "already served by another process",
    );
    expect(
      (
        await wire(service, "evil.review.test", "/api/state", {
          token: owner.token,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await wire(service, "manage.review.test", "/api/v1/workspaces", {
          method: "POST",
          token: "c".repeat(64),
          origin: "https://evil.test",
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await wire(service, "manage.review.test", "/api/v1/workspaces", {
          method: "POST",
          token: "c".repeat(64),
          origin: "https://manage.review.test",
          body: JSON.stringify({ seedRoot: "../../etc" }),
        })
      ).status,
    ).toBe(400);
    await service.close();
    service = await startWorkspaceService(options);
    cleanup.push(service);
    const restored = await wire(
      service,
      "manage.review.test",
      `/api/v1/workspaces/${created.workspace.id}`,
      { token: owner.token, origin: "https://manage.review.test" },
    );
    expect(restored.status).toBe(200);
    expect(restored.json().sessions.ownerUrl).toBe(created.sessions.ownerUrl);
    expect(
      (await wire(service, owner.host, "/api/state", { token: owner.token }))
        .status,
    ).toBe(200);
  });

  it("waits for an accepted request before reset and removes expired workspaces", async () => {
    let clock = Date.parse("2026-08-29T00:00:00Z");
    const { service } = await serviceFixture({
      now: () => clock,
      ttlMs: 1000,
    });
    const created = await create(service);
    const owner = access(created);
    const address = service.server.address();
    let finishSlow;
    const slowResponse = new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/api/comments",
          method: "POST",
          agent: false,
          headers: {
            Host: owner.host,
            Origin: owner.origin,
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.write("{");
      finishSlow = () => request.end("}");
    });
    await delay(30);
    let resetSettled = false;
    const reset = wire(
      service,
      "manage.review.test",
      `/api/v1/workspaces/${created.workspace.id}/reset`,
      {
        method: "POST",
        token: owner.token,
        origin: "https://manage.review.test",
        body: "{}",
      },
    ).then((response) => {
      resetSettled = true;
      return response;
    });
    await delay(30);
    expect(resetSettled).toBe(false);
    finishSlow();
    expect(await slowResponse).toBe(409);
    const resetResponse = await reset;
    expect(resetResponse.status).toBe(200);

    const currentOwner = access(resetResponse.json());
    clock += 1001;
    await service.cleanup();
    expect(service.store.list()).toEqual([]);
    expect(
      (
        await wire(service, currentOwner.host, "/api/state", {
          token: currentOwner.token,
        })
      ).status,
    ).toBe(404);
  });
});
