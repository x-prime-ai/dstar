import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openDocument } from "@dstar/core";
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
  const engine = openDocument(seedRoot);
  const proposal = engine.propose({
    candidate,
    base: null,
    request: "Initial seed",
    author: "seed-builder",
    key: randomUUID(),
  });
  const state = engine.snapshot();
  openDocument(seedRoot).decide(
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

async function create(
  service,
  { host = "manage.review.test", origin = "https://manage.review.test" } = {},
) {
  const response = await wire(service, host, "/api/v1/workspaces", {
    method: "POST",
    token: "c".repeat(64),
    origin,
    body: "{}",
  });
  expect(response.status, response.text).toBe(201);
  return response.json();
}

function access(result, role = "owner") {
  const url = new URL(result.sessions[`${role}Url`]);
  return { host: url.host, origin: url.origin, token: url.hash.slice(1) };
}

function documentApi(state, path) {
  return `/api/documents/${state.state.id}/${path}`;
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
    const oneReviewer = access(first, "reviewer");
    const twoReviewer = access(second, "reviewer");
    expect(first.workspace.id).not.toBe(second.workspace.id);
    expect(one.token).not.toBe(two.token);
    expect(oneReviewer.token).not.toBe(one.token);
    expect(oneReviewer.token).not.toBe(twoReviewer.token);
    expect(managementUrls).toEqual([first.manageUrl, second.manageUrl]);

    const oneState = await wire(service, one.host, "/api/state", {
      token: one.token,
    });
    const twoState = await wire(service, two.host, "/api/state", {
      token: two.token,
    });
    expect(oneState.status).toBe(200);
    expect(twoState.status).toBe(200);
    expect(oneState.json().session.role).toBe("owner");
    expect(
      (
        await wire(service, oneReviewer.host, "/api/state", {
          token: oneReviewer.token,
        })
      ).json().session.role,
    ).toBe("reviewer");
    expect(oneState.json()).not.toHaveProperty("workspaceManagementUrl");
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
        await wire(service, one.host, documentApi(state, "comments"), {
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
      await wire(
        service,
        one.host,
        documentApi(state, `preview/${proposal.id}`),
        {
          token: one.token,
        },
      )
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
    expect(
      (
        await wire(service, twoReviewer.host, "/api/state", {
          token: oneReviewer.token,
        })
      ).status,
    ).toBe(401);
  });

  it("drains reset, rotates links and capabilities, and restores the seed", async () => {
    const { service, proposal } = await serviceFixture();
    const created = await create(service);
    const old = access(created),
      oldReviewer = access(created, "reviewer");
    const state = (
      await wire(service, old.host, "/api/state", { token: old.token })
    ).json();
    const preview = (
      await wire(
        service,
        old.host,
        documentApi(state, `preview/${proposal.id}`),
        {
          token: old.token,
        },
      )
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
    expect(state.session.role).toBe("owner");
    expect(state.workspaceManagementUrl).toBe(created.manageUrl);
    const reviewerState = (
      await wire(service, oldReviewer.host, "/api/state", {
        token: oldReviewer.token,
      })
    ).json();
    expect(reviewerState.session.role).toBe("reviewer");
    expect(reviewerState).not.toHaveProperty("workspaceManagementUrl");
    const commentResponse = await wire(
      service,
      old.host,
      documentApi(state, "comments"),
      {
        method: "POST",
        token: oldReviewer.token,
        origin: oldReviewer.origin,
        body: JSON.stringify({
          body: "Will be reset",
          target,
        }),
      },
    );
    expect(commentResponse.status).toBe(201);
    const comment = commentResponse.json();
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
              selection: null,
              action: {
                kind: "address-comment",
                commentId: comment.id,
                target: comment.target,
                draft: "",
              },
              review: null,
              focusedCommentId: comment.id,
            },
          }),
        })
      ).status,
    ).toBe(201);
    const context = {
      selection: null,
      action: {
        kind: "address-comment",
        commentId: comment.id,
        target: comment.target,
        draft: "",
      },
      review: null,
      focusedCommentId: comment.id,
    };
    expect(
      (
        await wire(service, old.host, documentApi(state, "review-context"), {
          method: "POST",
          token: handoffToken,
          origin: old.origin,
          body: JSON.stringify(context),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await wire(
          service,
          old.host,
          `/api/handoffs/${handoffId}/reply-draft`,
          {
            method: "POST",
            token: handoffToken,
            origin: old.origin,
            body: JSON.stringify({
              commentId: comment.id,
              body: "Draft before reset",
            }),
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await wire(service, old.host, `/api/handoffs/${handoffId}`, {
          token: old.token,
        })
      ).json().replyDraft.body,
    ).toBe("Draft before reset");

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
    const next = access(reset),
      nextReviewer = access(reset, "reviewer");
    expect(reset.workspace.generation).toBe(2);
    expect(next.origin).toBe(old.origin);
    expect(next.token).not.toBe(old.token);
    expect(nextReviewer.token).not.toBe(oldReviewer.token);
    expect(nextReviewer.token).not.toBe(next.token);
    expect(
      (await wire(service, old.host, "/api/state", { token: old.token }))
        .status,
    ).toBe(401);
    expect(
      (
        await wire(service, oldReviewer.host, "/api/state", {
          token: oldReviewer.token,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await wire(
          service,
          "manage.review.test",
          `/api/v1/workspaces/${created.workspace.id}`,
          { token: old.token },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await wire(
          service,
          "manage.review.test",
          `/api/v1/workspaces/${created.workspace.id}/reset`,
          {
            method: "POST",
            token: nextReviewer.token,
            origin: "https://manage.review.test",
            body: "{}",
          },
        )
      ).status,
    ).toBe(401);
    expect((await wire(service, next.host, preview.url)).status).toBe(404);
    for (const [method, path] of [
      ["GET", "/api/state"],
      ["GET", `/api/handoffs/${handoffId}`],
      ["POST", `/api/handoffs/${handoffId}/reply-draft`],
      ["POST", `/api/handoffs/${handoffId}/revoke`],
      ["POST", documentApi(state, "review-context")],
      ["GET", documentApi(state, `revisions/${state.revision}/files`)],
      ["POST", documentApi(state, "proposals")],
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
        await wire(service, next.host, `/api/handoffs/${handoffId}/revoke`, {
          method: "POST",
          token: old.token,
          origin: next.origin,
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await wire(service, next.host, `/api/handoffs/${handoffId}/revoke`, {
          method: "POST",
          token: next.token,
          origin: next.origin,
          body: "{}",
        })
      ).status,
    ).toBe(404);
    const nextState = (
      await wire(service, next.host, "/api/state", { token: next.token })
    ).json();
    expect(nextState.state.comments).toHaveLength(0);
    expect(nextState.session.role).toBe("owner");
    expect(nextState.workspaceManagementUrl).toBe(reset.manageUrl);
    expect(
      (
        await wire(service, nextReviewer.host, "/api/state", {
          token: nextReviewer.token,
        })
      ).json(),
    ).toMatchObject({ session: { role: "reviewer" } });
    const nextTarget = { ...target, revision: nextState.revision };
    const nextComment = (
      await wire(
        service,
        nextReviewer.host,
        documentApi(nextState, "comments"),
        {
          method: "POST",
          token: nextReviewer.token,
          origin: nextReviewer.origin,
          body: JSON.stringify({
            target: nextTarget,
            body: "New generation comment",
          }),
        },
      )
    ).json();
    const nextHandoffId = "33333333-3333-4333-8333-333333333333";
    const nextHandoffToken = "k".repeat(64);
    const nextContext = {
      review: null,
      selection: null,
      action: {
        kind: "address-comment",
        commentId: nextComment.id,
        target: nextComment.target,
        draft: "",
      },
      focusedCommentId: nextComment.id,
    };
    expect(
      (
        await wire(service, next.host, "/api/handoffs", {
          method: "POST",
          token: next.token,
          origin: next.origin,
          body: JSON.stringify({
            id: nextHandoffId,
            accessToken: nextHandoffToken,
            context: nextContext,
          }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await wire(
          service,
          next.host,
          `/api/handoffs/${nextHandoffId}/reply-draft`,
          {
            method: "POST",
            token: nextHandoffToken,
            origin: next.origin,
            body: JSON.stringify({
              commentId: nextComment.id,
              body: "New generation draft",
            }),
          },
        )
      ).status,
    ).toBe(200);
  });

  it("keeps the current generation usable when the replacement Viewer cannot start", async () => {
    let failReplacement = false;
    const { service } = await serviceFixture({
      sessionAdapter: {
        start({ viewerOptions, workspace, workspaceManagementUrl }) {
          if (failReplacement && workspace.generation === 2)
            throw new Error("Injected replacement Viewer failure");
          return { ...viewerOptions, workspaceManagementUrl };
        },
      },
    });
    const created = await create(service);
    const owner = access(created);
    failReplacement = true;
    const failed = await wire(
      service,
      "manage.review.test",
      `/api/v1/workspaces/${created.workspace.id}/reset`,
      {
        method: "POST",
        token: owner.token,
        origin: "https://manage.review.test",
        body: "{}",
      },
    );
    expect(failed.status).toBe(500);
    const retained = service.store.load(created.workspace.id);
    expect(retained.metadata.generation).toBe(1);
    expect(retained.credentials.ownerToken).toBe(owner.token);

    failReplacement = false;
    const reopened = await wire(
      service,
      "manage.review.test",
      `/api/v1/workspaces/${created.workspace.id}`,
      { token: owner.token, origin: "https://manage.review.test" },
    );
    expect(reopened.status).toBe(200);
    expect(reopened.json().workspace.generation).toBe(1);
    expect(reopened.json().sessions.ownerUrl).toBe(created.sessions.ownerUrl);
    const retried = await wire(
      service,
      "manage.review.test",
      `/api/v1/workspaces/${created.workspace.id}/reset`,
      {
        method: "POST",
        token: owner.token,
        origin: "https://manage.review.test",
        body: "{}",
      },
    );
    expect(retried.status).toBe(200);
    expect(retried.json().workspace.generation).toBe(2);
  });

  it("uses an explicit control HTTPS port for workspace origins and Host checks", async () => {
    const fixtureValue = fixture();
    const service = await startWorkspaceService({
      root: join(fixtureValue.root, "runtime"),
      seedRoot: fixtureValue.seedRoot,
      externalOrigin: "https://manage.review.test:8443",
      workspaceDomain: "review.test",
      creationToken: "c".repeat(64),
      cleanupIntervalMs: 60_000,
    });
    cleanup.push(service);
    const created = await create(service, {
      host: "manage.review.test:8443",
      origin: "https://manage.review.test:8443",
    });
    const owner = access(created);
    expect(owner.host).toBe(`${created.workspace.id}.review.test:8443`);
    expect(owner.origin).toBe(
      `https://${created.workspace.id}.review.test:8443`,
    );
    expect(
      (await wire(service, owner.host, "/api/state", { token: owner.token }))
        .status,
    ).toBe(200);
    expect(
      (
        await wire(
          service,
          `${created.workspace.id}.review.test`,
          "/api/state",
          {
            token: owner.token,
          },
        )
      ).status,
    ).toBe(403);
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
    const ownerState = (
      await wire(service, owner.host, "/api/state", { token: owner.token })
    ).json();
    const address = service.server.address();
    let finishSlow;
    const slowResponse = new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: documentApi(ownerState, "comments"),
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
