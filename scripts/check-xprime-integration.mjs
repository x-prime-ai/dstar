import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const argumentIndex = process.argv.indexOf("--xprime-root");
const configuredRoot =
  argumentIndex === -1
    ? process.env.XPRIME_ROOT
    : process.argv[argumentIndex + 1];
if (!configuredRoot) {
  throw new Error(
    "Set XPRIME_ROOT or pass --xprime-root <path> to the real xPrime checkout",
  );
}
const xprimeRoot = resolve(configuredRoot);

const harness = await import(
  pathToFileURL(join(xprimeRoot, "packages/harness/dist/index.js")).href
);
const mcpClient = await import(
  pathToFileURL(join(xprimeRoot, "packages/mcp/client/dist/index.js")).href
);
const dstarNode = await import(
  pathToFileURL(join(repositoryRoot, "packages/node/dist/index.js")).href
);

const temporary = await mkdtemp(join(tmpdir(), "dstar-xprime-integration-"));
const packageRoot = join(temporary, "fixture.dstar");
const runtimeRoot = join(temporary, "runtime");
await cp(join(repositoryRoot, "spec/0.1/examples/minimal.dstar"), packageRoot, {
  recursive: true,
});
const repository = new dstarNode.PackageRepository(runtimeRoot);
const commands = new dstarNode.PackageCommands(repository);
const opened = await repository.open(packageRoot);
await commands.createDelegation(
  opened,
  {
    id: "delegation_xprime_real",
    annotationId: "ann_0001",
    assignee: { type: "agent", id: "agent_demo" },
    createdBy: { type: "human", id: "human_xprime_test" },
    createdAt: "2026-08-26T15:00:00Z",
    instruction: "Propose the requested wording clarification.",
  },
  {
    expectedSnapshotId: opened.snapshotId,
    idempotencyKey: "xprime-real-delegation",
  },
);

const runtime = await harness.HarnessRuntime.create({
  state: new harness.MemoryStateAdapter(),
});
const graph = await runtime.installPluginGraph([
  mcpClient.defineMcpClientPlugin({
    id: "mcp.dstar",
    serverName: "dstar",
    command: process.execPath,
    args: [
      join(repositoryRoot, "apps/cli/dist/main.js"),
      "mcp",
      "document",
      packageRoot,
      "--actor",
      "agent_demo",
      "--runtime-root",
      runtimeRoot,
    ],
    approval: "never",
    startupTimeoutMs: 15_000,
    toolCallTimeoutMs: 30_000,
  }),
]);

const presetContent = {
  harnessVersion: "0.0.0",
  protocolVersion: "1",
  preset: { id: "dstar-integration", revision: "1", digest: "sha256:dstar" },
  modelPolicy: { id: "deterministic", revision: "1", digest: "sha256:model" },
  plugins: [],
};
const preset = {
  ...presetContent,
  digest: harness.resolvedPresetDigest(presetContent),
};
const state = new harness.MemoryStateAdapter();
const sessions = new harness.SessionEngine({ state, now: () => 1 });
const session = harness.sessionId("dstar-xprime-integration");
await sessions.createSession(session, preset);
await sessions.startRun(
  session,
  harness.runId("dstar-xprime-run"),
  "Complete the assigned DSTAR task and submit a pending proposal.",
);

const publicName = (raw) => `mcp__dstar__${raw}`;
const operation = (await repository.open(packageRoot)).changes.find(
  (change) => change.id === "change_0001",
).operations[0];
let taskToken;
const toolCall = (id, name, argumentsValue) => [
  {
    type: "tool-call",
    call: { id, name: publicName(name), arguments: argumentsValue },
  },
  { type: "finish", reason: "tool-calls" },
];
const toolValue = (request) => {
  const message = request.messages.at(-1);
  assert.equal(message?.role, "tool");
  return JSON.parse(message.content);
};
const model = new harness.FakeModelAdapter([
  (request) => {
    const names = request.tools.map((tool) => tool.name);
    for (const rawName of [
      "list_tasks",
      "start_task",
      "get_task",
      "get_manifest",
      "get_node",
      "search_document",
      "get_annotation",
      "get_source",
      "simulate_update",
      "submit_result",
      "submit_genesis",
    ]) {
      assert.ok(
        names.includes(publicName(rawName)),
        `xPrime did not discover ${rawName}`,
      );
    }
    for (const forbidden of [
      "accept",
      "reject",
      "supersede",
      "resolve",
      "shell",
    ])
      assert.ok(!names.includes(publicName(forbidden)));
    return toolCall("call-list", "list_tasks", {});
  },
  (request) => {
    const tasks = toolValue(request);
    assert.equal(tasks[0].delegationId, "delegation_xprime_real");
    return toolCall("call-start", "start_task", {
      delegationId: "delegation_xprime_real",
    });
  },
  (request) => {
    taskToken = toolValue(request).taskToken;
    assert.equal(typeof taskToken, "string");
    return toolCall("call-task", "get_task", { taskToken });
  },
  (request) => {
    assert.equal(toolValue(request).delegation.id, "delegation_xprime_real");
    return toolCall("call-manifest", "get_manifest", { taskToken });
  },
  (request) => {
    assert.equal(toolValue(request).manifest.id, "doc_minimal");
    return toolCall("call-node", "get_node", {
      taskToken,
      nodeId: "node_promise",
    });
  },
  (request) => {
    assert.equal(toolValue(request).node.id, "node_promise");
    return toolCall("call-search", "search_document", {
      taskToken,
      query: "Humans direct",
    });
  },
  (request) => {
    assert.equal(toolValue(request).results[0].nodeId, "node_promise");
    return toolCall("call-annotation", "get_annotation", {
      taskToken,
      annotationId: "ann_0001",
    });
  },
  (request) => {
    assert.equal(toolValue(request).annotation.id, "ann_0001");
    return toolCall("call-source", "get_source", {
      taskToken,
      sourceId: "source_dstar_spec",
    });
  },
  (request) => {
    assert.equal(toolValue(request).source.id, "source_dstar_spec");
    return toolCall("call-simulate", "simulate_update", {
      taskToken,
      operations: [operation],
      sourceIds: ["source_dstar_spec"],
    });
  },
  (request) => {
    assert.equal(toolValue(request).simulation.applicability, "applicable");
    return toolCall("call-submit", "submit_result", {
      taskToken,
      idempotencyKey: "xprime-real-terminal",
      operations: [operation],
      sourceIds: ["source_dstar_spec"],
      replyBody: "Prepared through the real xPrime MCP bridge.",
    });
  },
  (request) => {
    const submitted = toolValue(request);
    assert.equal(submitted.status, "pending-human-decision");
    return [
      { type: "text-delta", text: `submitted ${submitted.changeId}` },
      { type: "finish", reason: "stop" },
    ];
  },
]);

try {
  const completed = await new harness.AgentRunner({
    sessions,
    model,
    execution: new harness.FakeExecutionAdapter(),
    tools: runtime.ctx.tools,
    route: { provider: "fake", model: "deterministic", reason: "integration" },
    ids: new harness.SequenceIdSource(),
    caller: {
      workspaceId: "dstar-workspace",
      principalId: "dstar-agent",
      capabilityIds: ["model.invoke"],
    },
  }).run(session);
  assert.equal(completed.runs[0]?.status, "completed");
  const finalPackage = await repository.open(packageRoot);
  const proposed = finalPackage.changes.find(
    (change) => change.idempotencyKey === "xprime-real-terminal",
  );
  assert.equal(proposed?.status, "proposed");
  assert.equal(finalPackage.manifest.headChange, "change_genesis_0001");
  console.log(
    `Real xPrime deterministic Session passed: ${proposed.id} remains proposed at ${finalPackage.manifest.revision}.`,
  );
} finally {
  await graph.dispose();
  await runtime.dispose();
}
