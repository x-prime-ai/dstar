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
  readonly legacySubscriptionMethods: readonly string[];
  readonly notificationCapabilities: {
    readonly available: {
      readonly listChanged: true;
      readonly subscribe: true;
    };
    readonly unavailable: {
      readonly listChanged: false;
      readonly subscribe: false;
    };
  };
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

function brokerStub(
  options: {
    readonly notificationsAvailable?: boolean;
    readonly listResources?: DstarMcpBroker["listResources"];
  } = {},
): DstarMcpBroker {
  return {
    resourceSubscriptionsAvailable: options.notificationsAvailable ?? true,
    listResources: options.listResources ?? (async () => []),
    readResource: async () => {
      throw new Error("Resource reads are not used by this test broker");
    },
    watchResources: () => () => undefined,
  } as unknown as DstarMcpBroker;
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

  it("shares one resource catalog across all templates in a list request", async () => {
    let listCalls = 0;
    const server = createDstarMcpServer(
      brokerStub({
        listResources: async () => {
          listCalls += 1;
          return [];
        },
      }),
    );
    const client = new Client({ name: "dstar-list-test", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      await client.listResources();
      expect(listCalls).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("advertises no Resource notifications when the watcher is unavailable", async () => {
    const server = createDstarMcpServer(
      brokerStub({ notificationsAvailable: false }),
    );
    const client = new Client({
      name: "dstar-capability-test",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      expect(client.getServerCapabilities()?.resources).toEqual(
        resourceFixture.notificationCapabilities.unavailable,
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

  it("implements scoped legacy subscribe and unsubscribe requests", async () => {
    const { broker, packageRoot } = await brokerFixtureWithRoot();
    const server = createDstarMcpServer(broker);
    const client = new Client({
      name: "dstar-legacy-subscription-test",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const updated = new Promise<string>((resolveUpdated, rejectUpdated) => {
      const timeout = setTimeout(
        () =>
          rejectUpdated(new Error("legacy resource update was not delivered")),
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
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      expect(client.getServerCapabilities()?.resources).toEqual(
        resourceFixture.notificationCapabilities.available,
      );
      expect(resourceFixture.legacySubscriptionMethods).toEqual([
        "resources/subscribe",
        "resources/unsubscribe",
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
      await client.close();
      await server.close();
    }
  });

  it("reports only Resource contents that actually changed", async () => {
    const { broker, packageRoot } = await brokerFixtureWithRoot();
    let stopWatching = () => undefined;
    const changed = new Promise<{
      readonly uris: readonly string[];
      readonly listChanged: boolean;
    }>((resolveChanged, rejectChanged) => {
      const timeout = setTimeout(
        () => rejectChanged(new Error("resource diff was not delivered")),
        5_000,
      );
      timeout.unref?.();
      stopWatching = broker.watchResources((change) => {
        clearTimeout(timeout);
        resolveChanged(change);
      });
    });
    try {
      const manifestPath = join(packageRoot, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.title = `${manifest.title} updated`;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      expect(await changed).toEqual({
        uris: ["dstar://document/manifest"],
        listChanged: true,
      });
    } finally {
      stopWatching();
    }
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
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.title = `${manifest.title} updated`;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
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
