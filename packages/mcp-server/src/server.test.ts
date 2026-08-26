import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { PackageCommands, PackageRepository } from "@dstar/node";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DstarMcpBroker, MCP_TOOL_NAMES } from "./broker.js";
import { MCP_TOOL_SCHEMAS, createDstarMcpServer } from "./server.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);

function forbiddenSchemaKeyword(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = forbiddenSchemaKeyword(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" || key === "oneOf" || key === "allOf") return key;
    const found = forbiddenSchemaKeyword(child);
    if (found) return found;
  }
  return undefined;
}

async function brokerFixture() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-mcp-server-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  const runtimeRoot = join(temporary, "runtime");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  const repository = new PackageRepository(runtimeRoot);
  const snapshot = await repository.open(packageRoot);
  await new PackageCommands(repository).createDelegation(
    snapshot,
    {
      id: "delegation_mcp_transport",
      annotationId: "ann_0001",
      assignee: { type: "agent", id: "agent_demo" },
      createdBy: { type: "human", id: "human_transport" },
      createdAt: "2026-08-26T14:00:00Z",
    },
    {
      expectedSnapshotId: snapshot.snapshotId,
      idempotencyKey: "transport-delegation",
    },
  );
  return DstarMcpBroker.create({
    mode: "document",
    packageRoot,
    runtimeRoot,
    actorId: "agent_demo",
    token: () => "transport-token",
  });
}

describe("official MCP v2 adapter", () => {
  it("uses xPrime-compatible stable names and flattened schemas", () => {
    expect(Object.keys(MCP_TOOL_SCHEMAS)).toEqual(MCP_TOOL_NAMES);
    for (const schema of Object.values(MCP_TOOL_SCHEMAS)) {
      expect(forbiddenSchemaKeyword(schema)).toBeUndefined();
    }
    expect(MCP_TOOL_NAMES).not.toEqual(
      expect.arrayContaining([
        "accept",
        "reject",
        "supersede",
        "resolve",
        "shell",
        "fetch",
      ]),
    );
  });

  it("negotiates and executes through the official client over a linked transport", async () => {
    const server = createDstarMcpServer(await brokerFixture());
    const client = new Client({
      name: "dstar-integration-test",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
      const listResult = await client.callTool({
        name: "list_tasks",
        arguments: {},
      });
      expect(listResult.isError).not.toBe(true);
      const text = listResult.content.find((block) => block.type === "text");
      expect(text?.type === "text" ? text.text : "").toContain(
        "delegation_mcp_transport",
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
