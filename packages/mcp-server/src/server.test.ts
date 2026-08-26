import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { PackageCommands, PackageRepository } from "@dstar/node";
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
) as {
  readonly templates: readonly string[];
  readonly resources: readonly string[];
};

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

async function brokerFixtureWithRoot() {
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
  return {
    packageRoot,
    broker: await DstarMcpBroker.create({
      mode: "document",
      packageRoot,
      runtimeRoot,
      actorId: "agent_demo",
      token: () => "transport-token",
    }),
  };
}

async function brokerFixture() {
  return (await brokerFixtureWithRoot()).broker;
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
      const templates = await client.listResourceTemplates();
      expect(
        templates.resourceTemplates.map((template) => template.uriTemplate),
      ).toEqual(resourceFixture.templates);
      expect(DSTAR_RESOURCE_URI_TEMPLATES).toEqual(resourceFixture.templates);
      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual(
        resourceFixture.resources,
      );
      expect(
        resources.resources.every(
          (resource) => resource.annotations?.audience?.[0] === "assistant",
        ),
      ).toBe(true);
      const manifestResource = await client.readResource({
        uri: "dstar://document/manifest",
      });
      expect(manifestResource.contents).toHaveLength(1);
      const manifestContent = manifestResource.contents[0];
      expect(
        manifestContent?.text
          ? JSON.parse(manifestContent.text).manifest.id
          : undefined,
      ).toBe("doc_minimal");
      await expect(
        client.readResource({ uri: "file:///etc/passwd" }),
      ).rejects.toThrow();
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

  it("never exposes a genesis draft output path as a Resource", async () => {
    const draftRoot = await mkdtemp(join(tmpdir(), "dstar-genesis-resource-"));
    await writeFile(
      join(draftRoot, "draft.json"),
      JSON.stringify({
        format: "dstar-genesis-draft/0.1",
        request: {
          output: "/private/secret/output.dstar",
          documentId: "doc_genesis_resource",
          title: "Scoped genesis",
          profiles: ["dstar:base"],
          actor: { type: "human", id: "human_genesis" },
          body: "Create a scoped document.",
          createdAt: "2026-08-26T00:00:00Z",
        },
      }),
    );
    const broker = await DstarMcpBroker.create({
      mode: "genesis",
      draftRoot,
      actorId: "agent_genesis",
    });
    const content = await broker.readResource("dstar://genesis/request");
    expect(content.text).toContain("doc_genesis_resource");
    expect(content.text).not.toContain("/private/secret");
    expect(content.text).not.toContain('"output"');
  });

  it("delivers scoped resource updates through modern subscriptions/listen", async () => {
    const { broker, packageRoot } = await brokerFixtureWithRoot();
    let stopDirectWatch = () => undefined;
    const directlyWatched = new Promise<void>((resolveDirect, rejectDirect) => {
      const timeout = setTimeout(
        () => rejectDirect(new Error("direct resource watch did not fire")),
        1_000,
      );
      stopDirectWatch = broker.watchResources(() => {
        clearTimeout(timeout);
        resolveDirect();
      });
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const handle = serveStdio(() => createDstarMcpServer(broker), {
      transport: serverTransport,
      legacy: "serve",
    });
    const client = new Client(
      {
        name: "dstar-subscription-test",
        version: "0.0.0",
      },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const updated = new Promise<string>((resolveUpdated, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("resource update was not delivered")),
        5_000,
      );
      timeout.unref?.();
      client.setNotificationHandler(
        "notifications/resources/updated",
        (notification) => {
          clearTimeout(timeout);
          resolveUpdated(notification.params.uri);
        },
      );
    });
    try {
      await client.connect(clientTransport);
      const subscription = await client.listen({
        resourceSubscriptions: ["dstar://document/manifest"],
      });
      expect(subscription.honoredFilter).toEqual({
        resourceSubscriptions: ["dstar://document/manifest"],
      });
      const manifestPath = join(packageRoot, "manifest.json");
      await writeFile(
        manifestPath,
        `${await readFile(manifestPath, "utf8")}\n`,
      );
      await directlyWatched;
      expect(await updated).toBe("dstar://document/manifest");
      await subscription.close();
    } finally {
      await client.close();
      await handle.close();
      stopDirectWatch();
    }
  });
});
