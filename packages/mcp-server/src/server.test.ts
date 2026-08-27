import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DSTAR_RESOURCE_URI_TEMPLATES,
  DstarMcpBroker,
  MCP_TOOL_NAMES,
} from "./broker.js";
import { MCP_TOOL_SCHEMAS, createDstarMcpServer } from "./server.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);
const resourceFixture = JSON.parse(
  await readFile(
    resolve(import.meta.dirname, "../../../spec/0.1/tests/mcp/resources.json"),
    "utf8",
  ),
) as { templates: string[]; resources: string[] };

function forbiddenSchemaTerm(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(forbiddenSchemaTerm).find(Boolean);
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "$ref",
        "oneOf",
        "allOf",
        "taskToken",
        "delegationId",
        "agentId",
      ].includes(key)
    )
      return key;
    const found = forbiddenSchemaTerm(child);
    if (found) return found;
  }
  return undefined;
}

async function fixtureBroker() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-mcp-server-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  return DstarMcpBroker.create({
    mode: "document",
    packageRoot,
    runtimeRoot: join(temporary, "runtime"),
    principalId: "human_demo",
  });
}

async function fixtureBrokerWithRoot() {
  const temporary = await mkdtemp(join(tmpdir(), "dstar-mcp-server-test-"));
  const packageRoot = join(temporary, "fixture.dstar");
  await cp(fixtureRoot, packageRoot, { recursive: true });
  return {
    packageRoot,
    broker: await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot: join(temporary, "runtime"),
      principalId: "human_demo",
    }),
  };
}

describe("official MCP adapter", () => {
  it("publishes a caller-independent, decision-free tool contract", () => {
    expect(Object.keys(MCP_TOOL_SCHEMAS)).toEqual(MCP_TOOL_NAMES);
    expect(MCP_TOOL_NAMES).not.toEqual(
      expect.arrayContaining([
        "list_tasks",
        "start_task",
        "get_task",
        "accept",
        "reject",
        "resolve",
        "delegate",
      ]),
    );
    for (const schema of Object.values(MCP_TOOL_SCHEMAS))
      expect(forbiddenSchemaTerm(schema)).toBeUndefined();
  });

  it("negotiates tools and fixed-document resources through the official client", async () => {
    const server = createDstarMcpServer(await fixtureBroker());
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
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
        MCP_TOOL_NAMES,
      );
      expect(
        (await client.listResourceTemplates()).resourceTemplates.map(
          (item) => item.uriTemplate,
        ),
      ).toEqual(resourceFixture.templates);
      expect(DSTAR_RESOURCE_URI_TEMPLATES).toEqual(resourceFixture.templates);
      const resources = await client.listResources();
      expect(resources.resources.map((item) => item.uri)).toEqual(
        resourceFixture.resources,
      );
      expect(
        resources.resources.every((item) => item.annotations === undefined),
      ).toBe(true);
      const manifest = await client.readResource({
        uri: "dstar://document/manifest",
      });
      const content = manifest.contents[0];
      expect(
        content?.text ? JSON.parse(content.text).manifest.id : undefined,
      ).toBe("doc_minimal");
      await expect(
        client.readResource({ uri: "file:///etc/passwd" }),
      ).rejects.toThrow();
      const comments = await client.callTool({
        name: "list_comments",
        arguments: { assignedToMe: true },
      });
      expect(comments.isError).not.toBe(true);
      expect(
        comments.content.find((item) => item.type === "text")?.text,
      ).toContain("ann_0001");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("delivers updates only for subscribed resources", async () => {
    const { broker, packageRoot } = await fixtureBrokerWithRoot();
    const server = createDstarMcpServer(broker);
    const client = new Client({
      name: "dstar-subscription-test",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const updated = new Promise<string>((resolveUpdated, rejectUpdated) => {
      timeout = setTimeout(
        () => rejectUpdated(new Error("resource update was not delivered")),
        5_000,
      );
      timeout.unref?.();
      client.setNotificationHandler(
        "notifications/resources/updated",
        (notification) => {
          if (timeout) clearTimeout(timeout);
          resolveUpdated(notification.params.uri);
        },
      );
    });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      await expect(
        client.subscribeResource({ uri: "file:///etc/passwd" }),
      ).rejects.toThrow();
      await client.subscribeResource({ uri: "dstar://document/manifest" });
      const manifestPath = join(packageRoot, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.title = `${manifest.title} updated`;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      expect(await updated).toBe("dstar://document/manifest");
      await client.unsubscribeResource({ uri: "dstar://document/manifest" });
    } finally {
      if (timeout) clearTimeout(timeout);
      await client.close();
      await server.close();
    }
  });
});
