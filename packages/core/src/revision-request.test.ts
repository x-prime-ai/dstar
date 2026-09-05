import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Repository } from "./repository.js";
import type { Comment, Proposal, Target } from "./types.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const html = (text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Rounds</title></head><body><main data-dstar-id="main"><p data-dstar-id="intro">${text}</p></main></body></html>`;

function setup() {
  const temp = fs.mkdtempSync(join(tmpdir(), "dstar-rounds-"));
  temporary.push(temp);
  const root = join(temp, "doc"),
    stage = join(temp, "stage");
  fs.mkdirSync(stage);
  const write = (text: string) =>
    fs.writeFileSync(join(stage, "document.html"), html(text));
  write("Initial text");
  const repo = new Repository(root);
  const propose = (
    base: string | null,
    request = "Initial draft",
    extra: Partial<Parameters<Repository["propose"]>[0]> = {},
  ) =>
    repo.propose({
      candidate: stage,
      base,
      request,
      author: "agent",
      key: randomUUID(),
      ...extra,
    });
  const accept = (proposal: Proposal) =>
    repo.decide(
      proposal.id,
      "accept",
      proposal.revision,
      repo.snapshot().stateId,
      "owner",
    );
  const genesis = propose(null);
  accept(genesis);
  const target = (): Target => ({
    revision: repo.snapshot().revision!,
    element: "intro",
    selector: { type: "element" },
  });
  const comment = (body: string): Comment =>
    repo.comment({ target: target(), body, author: "reviewer" });
  return {
    root,
    stage,
    repo,
    write,
    propose,
    accept,
    genesis,
    target,
    comment,
  };
}

describe("durable revision requests", () => {
  it("freezes three comments, replies and an Owner instruction across reopen and drift", () => {
    const f = setup();
    const comments = [
      f.comment("Clarify"),
      f.comment("Shorten"),
      f.comment("Cite"),
    ];
    f.repo.reply(comments[0]!.id, "Can do", "agent", "pre-submit");
    const base = f.repo.snapshot().revision;
    const request = f.repo.createRevisionRequest({
      base,
      instruction: "Keep the overall tone concise",
      commentIds: comments.map((comment) => comment.id).reverse(),
      requester: { id: "owner", displayName: "Document Owner", role: "owner" },
      key: "round-one",
    });
    expect(request.commentIds).toEqual(comments.map((c) => c.id).sort());
    expect(request.feedback).toHaveLength(3);
    expect(
      request.feedback.find((c) => c.id === comments[0]!.id)?.replies,
    ).toHaveLength(1);
    const frozen = JSON.stringify(request.feedback);
    f.repo.reply(comments[0]!.id, "Newer discussion", "reviewer");
    f.repo.resolveComment(comments[1]!.id, f.repo.snapshot().stateId, "owner");
    const reopened = new Repository(f.root).snapshot().state
      .revisionRequests[0]!;
    expect(JSON.stringify(reopened.feedback)).toBe(frozen);
    expect(reopened.status).toBe("submitted");
  });

  it("allows comments-only and instruction-only requests but rejects an empty request", () => {
    const f = setup(),
      comment = f.comment("Use a stronger verb"),
      base = f.repo.snapshot().revision;
    expect(
      f.repo.createRevisionRequest({
        base,
        commentIds: [comment.id],
        requester: "owner",
        key: "comments-only",
      }).request,
    ).toBe("Address selected review feedback");
    expect(
      f.repo.createRevisionRequest({
        base,
        instruction: "Normalize heading capitalization",
        requester: "owner",
        key: "instruction-only",
      }).feedback,
    ).toEqual([]);
    expect(() =>
      f.repo.createRevisionRequest({
        base,
        instruction: "  ",
        requester: "owner",
        key: "empty",
      }),
    ).toThrow("needs feedback or an instruction");
  });

  it("requires the current accepted base and an interpretable open anchor", () => {
    const f = setup(),
      old = f.comment("Old context"),
      staleBase = f.repo.snapshot().revision;
    f.write("Replacement text");
    const next = f.propose(staleBase);
    f.accept(next);
    expect(() =>
      f.repo.createRevisionRequest({
        base: staleBase,
        instruction: "Stale",
        requester: "owner",
        key: "stale",
      }),
    ).toThrow("Stale base");

    // The old element anchor remains interpretable on the new base.
    expect(() =>
      f.repo.createRevisionRequest({
        base: next.revision,
        commentIds: [old.id],
        requester: "owner",
        key: "recovered-element",
      }),
    ).not.toThrow();
    const missing: Target = {
      revision: f.genesis.revision,
      element: "intro",
      selector: {
        type: "text-range",
        start: 0,
        end: 7,
        unit: "unicode-code-point",
        exact: "Initial",
      },
    };
    const orphaned = f.repo.comment({
      target: missing,
      body: "This quotation disappears",
      author: "reviewer",
    });
    expect(() =>
      f.repo.createRevisionRequest({
        base: next.revision,
        commentIds: [orphaned.id],
        requester: "owner",
        key: "orphaned",
      }),
    ).toThrow("anchor is orphaned");
    f.repo.resolveComment(old.id, f.repo.snapshot().stateId, "owner");
    expect(() =>
      f.repo.createRevisionRequest({
        base: next.revision,
        commentIds: [old.id],
        requester: "owner",
        key: "resolved",
      }),
    ).toThrow("no longer open");
  });

  it("persists logical retry identity and ignores stale global state for current completion", () => {
    const f = setup(),
      request = f.repo.createRevisionRequest({
        base: f.repo.snapshot().revision,
        instruction: "Tighten",
        requester: "owner",
        key: "retry-request",
      });
    const before = f.repo.snapshot().stateId;
    expect(
      f.repo.updateRevisionRequest(request.id, {
        status: "submitted",
        attemptId: "external-1",
        expectedStateId: before,
      }).attempt,
    ).toBe(1);
    expect(() =>
      f.repo.updateRevisionRequest(request.id, {
        status: "running",
        attemptId: "competing-attempt",
      }),
    ).toThrow("already active");
    f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "external-1",
    });
    f.comment("Concurrent discussion");
    f.repo.updateRevisionRequest(request.id, {
      status: "failed",
      attemptId: "external-1",
      error: "Provider response was uncertain",
      expectedStateId: before,
    });
    const retry = f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "host-2",
      expectedStateId: f.repo.snapshot().stateId,
    });
    expect(retry).toMatchObject({
      attempt: 2,
      attemptId: "host-2",
      status: "running",
    });
    expect(() =>
      f.repo.updateRevisionRequest(request.id, {
        status: "expired",
        attemptId: "external-1",
        error: "Old callback",
      }),
    ).toThrow("superseded");
    expect(
      f.repo.updateRevisionRequest(request.id, {
        status: "running",
        attemptId: "host-2",
      }),
    ).toEqual(retry);
  });

  it("links one matching proposal and returns it with the request atomically", () => {
    const f = setup(),
      comments = [
        f.comment("Clarify"),
        f.comment("Shorten"),
        f.comment("Cite"),
      ],
      request = f.repo.createRevisionRequest({
        base: f.repo.snapshot().revision,
        instruction: "Apply all selected feedback",
        commentIds: comments.map((comment) => comment.id),
        requester: "owner",
        key: "linked-request",
      });
    f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "attempt-1",
    });
    f.write("Revised for all feedback");
    const proposal = f.propose(request.base, request.request, {
      key: "linked-result",
      requestId: request.id,
      attemptId: "attempt-1",
      commentIds: request.commentIds,
    });
    const reopened = new Repository(f.root).snapshot().state;
    expect(proposal).toMatchObject({
      requestId: request.id,
      motivatedBy: request.commentIds,
    });
    expect(reopened.revisionRequests[0]).toMatchObject({
      status: "returned",
      proposalId: proposal.id,
    });
    // The logical request reconciles duplicate delivery even with another key.
    expect(
      f.propose(request.base, request.request, {
        key: "duplicate-delivery",
        requestId: request.id,
        attemptId: "attempt-1",
        commentIds: request.commentIds,
      }).id,
    ).toBe(proposal.id);
    expect(
      f.repo
        .snapshot()
        .state.proposals.filter((p) => p.requestId === request.id),
    ).toHaveLength(1);
    expect(
      f.repo.updateRevisionRequest(request.id, {
        status: "expired",
        attemptId: "attempt-1",
        error: "Late callback",
      }).status,
    ).toBe("returned");
  });

  it("keeps the existing resolved-comment and stale-head proposal rejection", () => {
    const f = setup(),
      comment = f.comment("Selected"),
      request = f.repo.createRevisionRequest({
        base: f.repo.snapshot().revision,
        instruction: "Apply feedback",
        commentIds: [comment.id],
        requester: "owner",
        key: "drift",
      });
    f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "attempt-drift",
    });
    f.repo.resolveComment(comment.id, f.repo.snapshot().stateId, "owner");
    f.write("Candidate after resolution");
    expect(() =>
      f.propose(request.base, request.request, {
        requestId: request.id,
        attemptId: "attempt-drift",
        commentIds: request.commentIds,
      }),
    ).toThrow("no longer open");

    const current = f.repo.snapshot().revision;
    const staleRequest = f.repo.createRevisionRequest({
      base: current,
      instruction: "Instruction-only stale result",
      requester: "owner",
      key: "stale-during-invocation",
    });
    f.repo.updateRevisionRequest(staleRequest.id, {
      status: "running",
      attemptId: "stale-attempt",
    });
    f.write("Competing accepted edit");
    f.accept(f.propose(current));
    f.write("Old-base result");
    expect(() =>
      f.propose(staleRequest.base, staleRequest.request, {
        requestId: staleRequest.id,
        attemptId: "stale-attempt",
      }),
    ).toThrow("Stale base");
    expect(
      f.repo.updateRevisionRequest(staleRequest.id, {
        status: "conflicted",
        attemptId: "stale-attempt",
        error: "Accepted head changed during invocation",
      }).status,
    ).toBe("conflicted");
    expect(() =>
      f.repo.updateRevisionRequest(staleRequest.id, {
        status: "running",
        attemptId: "invalid-retry",
      }),
    ).toThrow("must be replaced");
  });

  it("fails closed on corrupt request records and linked proposal relationships", () => {
    const f = setup(),
      comment = f.comment("Snapshot me"),
      request = f.repo.createRevisionRequest({
        base: f.repo.snapshot().revision,
        instruction: "Preserve this contract",
        commentIds: [comment.id],
        requester: "owner",
        key: "corruption-check",
      }),
      record = join(f.root, ".dstar/revisionRequests/00000000.json"),
      original = JSON.parse(fs.readFileSync(record, "utf8"));
    const corruptions: ((value: Record<string, unknown>) => void)[] = [
      (value) => (value.base = "bad"),
      (value) => (value.request = "Different prose"),
      (value) => (value.commentIds = [comment.id, comment.id]),
      (value) =>
        ((value.feedback as { body: string }[])[0]!.body = "Changed snapshot"),
      (value) =>
        (value.requester = { id: "INVALID", displayName: "X", role: "owner" }),
      (value) => (value.createdAt = "yesterday"),
      (value) => (value.key = ""),
      (value) => (value.command = `sha256:${"0".repeat(64)}`),
      (value) => (value.status = "unknown"),
      (value) => (value.attempt = -1),
      (value) => (value.error = "unexpected"),
      (value) => (value.updatedAt = "tomorrow"),
    ];
    for (const corrupt of corruptions) {
      const value = JSON.parse(JSON.stringify(original));
      corrupt(value);
      fs.writeFileSync(record, JSON.stringify(value));
      expect(() => new Repository(f.root).snapshot()).toThrow();
    }
    fs.writeFileSync(record, JSON.stringify(original));
    f.repo.updateRevisionRequest(request.id, {
      status: "running",
      attemptId: "corrupt-link-attempt",
    });
    f.write("Linked result");
    const proposal = f.propose(request.base, request.request, {
      requestId: request.id,
      attemptId: "corrupt-link-attempt",
      commentIds: request.commentIds,
    });
    const proposalRecord = join(f.root, ".dstar/proposals/00000001.json"),
      proposalValue = JSON.parse(fs.readFileSync(proposalRecord, "utf8"));
    proposalValue.requestId = randomUUID();
    fs.writeFileSync(proposalRecord, JSON.stringify(proposalValue));
    expect(() => new Repository(f.root).snapshot()).toThrow(
      "linked revision proposal",
    );
    expect(proposal.requestId).toBe(request.id);
  });
});
