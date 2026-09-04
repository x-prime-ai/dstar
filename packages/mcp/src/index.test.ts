import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { openDocument, type ActorIdentity } from "@dstar/core";
import { afterEach, expect, it } from "vitest";

import { createDstarMcpServer, registerDstarTools } from "./index.js";

type Handler = (input: Record<string, unknown>) => Promise<{
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}>;

const cleanup: string[] = [];
afterEach(() => {
  for (const directory of cleanup.splice(0).reverse())
    rmSync(directory, { recursive: true, force: true });
});

function candidate(root: string, text: string): string {
  const directory = join(root, `candidate-${text}`);
  mkdirSync(directory);
  writeFileSync(
    join(directory, "document.html"),
    `<!doctype html><html><head><title>MCP</title></head><body><h1 data-dstar-id="title">${text}</h1></body></html>`,
  );
  return directory;
}

it("registers caller-scoped tools that drive the Core collaboration API", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "dstar-mcp-test-"));
  cleanup.push(temporary);
  const document = openDocument(join(temporary, "document.dstar"));
  const owner: ActorIdentity = {
    id: "owner-1",
    displayName: "Document Owner",
    role: "owner",
  };
  const genesis = document.propose({
    candidate: candidate(temporary, "First"),
    base: null,
    request: "Create document",
    author: owner,
    key: "genesis",
  });
  document.decide(
    genesis.id,
    "accept",
    genesis.revision,
    document.snapshot().stateId,
    owner,
  );

  expect(
    createDstarMcpServer({
      document,
      actor: owner,
      capabilities: ["read"],
    }),
  ).toBeDefined();

  const handlers = new Map<string, Handler>();
  const fakeServer = {
    registerTool(
      name: string,
      _config: unknown,
      handler: Handler,
    ): Record<string, never> {
      handlers.set(name, handler);
      return {};
    },
  };
  registerDstarTools(fakeServer as unknown as McpServer, {
    document,
    actor: owner,
    capabilities: ["read", "propose", "comment", "reply", "decide", "resolve"],
  });

  expect([...handlers.keys()]).toEqual([
    "dstar_get_document",
    "dstar_propose_revision",
    "dstar_add_comment",
    "dstar_reply_comment",
    "dstar_decide_proposal",
    "dstar_resolve_comment",
  ]);

  const add = await handlers.get("dstar_add_comment")!({
    target: {
      revision: genesis.revision,
      element: "title",
      selector: { type: "element" },
    },
    body: "Please clarify this heading",
  });
  expect(add.isError).not.toBe(true);
  const comment = add.structuredContent?.comment as { id: string };

  const reply = await handlers.get("dstar_reply_comment")!({
    commentId: comment.id,
    body: "Clarified in the next draft",
    key: "reply-1",
    expectedStateId: document.snapshot().stateId,
  });
  expect(reply.isError).not.toBe(true);
  expect(
    (reply.structuredContent?.comment as { replies: unknown[] }).replies[0],
  ).not.toHaveProperty("key");

  const unsafeCandidate = await handlers.get("dstar_propose_revision")!({
    base: genesis.revision,
    request: "Case collision",
    key: "case-collision",
    files: [
      {
        path: "document.html",
        encoding: "utf8",
        content:
          '<!doctype html><html><head><title>MCP</title></head><body><h1 data-dstar-id="title">Second</h1></body></html>',
      },
      { path: "assets/Icons/a.png", encoding: "base64", content: "AA==" },
      { path: "assets/icons/b.png", encoding: "base64", content: "AA==" },
    ],
  });
  expect(unsafeCandidate.isError).toBe(true);

  const proposed = await handlers.get("dstar_propose_revision")!({
    base: genesis.revision,
    request: "Clarify heading",
    key: "proposal-2",
    files: [
      {
        path: "document.html",
        encoding: "utf8",
        content:
          '<!doctype html><html><head><title>MCP</title></head><body><h1 data-dstar-id="title">Second</h1></body></html>',
      },
    ],
    commentIds: [comment.id],
  });
  const proposal = proposed.structuredContent?.proposal as {
    id: string;
    revision: string;
  };
  const decided = await handlers.get("dstar_decide_proposal")!({
    proposalId: proposal.id,
    action: "reject",
    expectedRevision: proposal.revision,
    expectedStateId: document.snapshot().stateId,
  });
  expect(decided.structuredContent?.proposal).toMatchObject({
    id: proposal.id,
    status: "rejected",
  });

  const resolved = await handlers.get("dstar_resolve_comment")!({
    commentId: comment.id,
    expectedStateId: document.snapshot().stateId,
  });
  expect(resolved.structuredContent?.comment).toMatchObject({
    id: comment.id,
    status: "resolved",
  });

  const read = await handlers.get("dstar_get_document")!({});
  expect(read.structuredContent).toMatchObject({
    revision: genesis.revision,
  });
  const comments = (
    read.structuredContent?.state as {
      comments: { replies: unknown[] }[];
    }
  ).comments;
  expect(comments[0]?.replies[0]).not.toHaveProperty("key");
});
