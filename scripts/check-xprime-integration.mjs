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
if (!configuredRoot)
  throw new Error(
    "Set XPRIME_ROOT or pass --xprime-root <path> to the real xPrime checkout",
  );
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
const workspaceServer = await import(
  pathToFileURL(join(repositoryRoot, "apps/workspace-server/dist/index.js"))
    .href
);

const temporary = await mkdtemp(join(tmpdir(), "dstar-xprime-integration-"));
const packageRoot = join(temporary, "fixture.dstar");
const runtimeRoot = join(temporary, "runtime");
await cp(join(repositoryRoot, "spec/0.1/examples/minimal.dstar"), packageRoot, {
  recursive: true,
});
const repository = new dstarNode.PackageRepository(runtimeRoot);
const human = { type: "human", id: "human_xprime_test" };
let reviewServer = await workspaceServer.startWorkspaceServer({
  packageRoot,
  runtimeRoot,
  human,
  now: () => "2026-08-26T15:00:00Z",
});

const apiHeaders = (mutation = false) => ({
  Authorization: `Bearer ${reviewServer.token}`,
  Origin: reviewServer.origin,
  ...(mutation
    ? {
        "Content-Type": "application/json",
        "X-DSTAR-CSRF": reviewServer.csrfToken,
      }
    : {}),
});
const api = async (path, init = {}) => {
  const response = await globalThis.fetch(
    `${reviewServer.origin}/api/v1${path}`,
    {
      ...init,
      headers: { ...apiHeaders(init.method === "POST"), ...init.headers },
    },
  );
  const value = await response.json();
  assert.equal(
    response.ok,
    true,
    `workspace ${path} failed: ${JSON.stringify(value)}`,
  );
  return value;
};
const mutation = (path, expectedSnapshotId, idempotencyKey, input) =>
  api(path, {
    method: "POST",
    body: JSON.stringify({ expectedSnapshotId, idempotencyKey, ...input }),
  });

const initialSnapshot = await api("/snapshot");
await mutation(
  "/annotations",
  initialSnapshot.snapshotId,
  "xprime-ui-comment",
  {
    purpose: "change-request",
    scope: "canonical",
    target: {
      source: "document",
      revision: initialSnapshot.manifest.revision,
      selector: { type: "NodeSelector", node: "node_promise" },
    },
    body: "Clarify the human review responsibility.",
    assigneeId: human.id,
    audience: ["human"],
  },
);
const annotationId = (await api("/annotations")).find(
  (item) => item.annotation.body === "Clarify the human review responsibility.",
).annotation.id;

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
      "--principal",
      human.id,
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
  "Read the fixed DSTAR document and submit a pending proposal.",
);

const current = await repository.open(packageRoot);
const operation = {
  ...current.changes.find((change) => change.id === "change_0001")
    .operations[0],
  id: "operation_xprime_integration",
};
const publicName = (raw) => `mcp__dstar__${raw}`;
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
const proposalInput = {
  idempotencyKey: "xprime-real-proposal",
  baseChange: current.manifest.headChange,
  baseRevision: current.manifest.revision,
  operations: [operation],
  motivatedBy: [annotationId],
  sourceIds: ["source_dstar_spec"],
};
let submittedChangeId;
const model = new harness.FakeModelAdapter([
  (request) => {
    const names = request.tools.map((tool) => tool.name);
    for (const rawName of [
      "get_manifest",
      "list_comments",
      "get_node",
      "search_document",
      "get_annotation",
      "get_source",
      "simulate_update",
      "submit_proposal",
      "reply_comment",
      "submit_genesis",
    ])
      assert.ok(
        names.includes(publicName(rawName)),
        `xPrime did not discover ${rawName}`,
      );
    for (const forbidden of [
      "list_tasks",
      "start_task",
      "get_task",
      "accept",
      "reject",
      "supersede",
      "resolve",
      "delegate",
    ])
      assert.ok(!names.includes(publicName(forbidden)));
    return toolCall("call-manifest", "get_manifest", {});
  },
  (request) => {
    assert.equal(toolValue(request).manifest.id, "doc_minimal");
    return toolCall("call-comments", "list_comments", {
      assignedToMe: true,
      openOnly: true,
    });
  },
  (request) => {
    assert.ok(
      toolValue(request).comments.some(
        (comment) => comment.id === annotationId,
      ),
    );
    return toolCall("call-node", "get_node", { nodeId: "node_promise" });
  },
  (request) => {
    assert.equal(toolValue(request).node.id, "node_promise");
    return toolCall("call-search", "search_document", {
      query: "Humans review",
    });
  },
  (request) => {
    assert.equal(toolValue(request).results[0].nodeId, "node_promise");
    return toolCall("call-annotation", "get_annotation", { annotationId });
  },
  (request) => {
    assert.equal(toolValue(request).annotation.id, annotationId);
    return toolCall("call-source", "get_source", {
      sourceId: "source_dstar_spec",
    });
  },
  (request) => {
    assert.equal(toolValue(request).source.id, "source_dstar_spec");
    return toolCall("call-simulate", "simulate_update", proposalInput);
  },
  (request) => {
    assert.equal(toolValue(request).simulation.applicability, "applicable");
    return toolCall("call-submit", "submit_proposal", proposalInput);
  },
  (request) => {
    const submitted = toolValue(request);
    assert.equal(submitted.status, "pending-human-decision");
    submittedChangeId = submitted.changeId;
    return toolCall("call-reply", "reply_comment", {
      annotationId,
      body: "Prepared through the real xPrime MCP client boundary.",
      idempotencyKey: "xprime-real-reply",
    });
  },
  (request) => {
    assert.equal(toolValue(request).annotationId, annotationId);
    return [
      { type: "text-delta", text: `submitted ${submittedChangeId}` },
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
      principalId: "xprime-test-host",
      capabilityIds: ["model.invoke"],
    },
  }).run(session);
  assert.equal(completed.runs[0]?.status, "completed");
  const finalPackage = await repository.open(packageRoot);
  const proposed = finalPackage.changes.find(
    (change) => change.id === submittedChangeId,
  );
  assert.equal(proposed?.status, "proposed");
  assert.deepEqual(proposed?.author, human);
  assert.equal(finalPackage.manifest.headChange, "change_genesis_0001");

  await reviewServer.close();
  reviewServer = await workspaceServer.startWorkspaceServer({
    packageRoot,
    runtimeRoot,
    human,
    now: () => "2026-08-26T15:05:00Z",
  });
  const reopenedSnapshot = await api("/snapshot");
  const simulation = await api(`/changes/${proposed.id}/simulation`);
  await mutation(
    `/changes/${proposed.id}/accept`,
    reopenedSnapshot.snapshotId,
    "xprime-ui-human-accept",
    {
      expectedResultRevision: simulation.resultRevision,
    },
  );
  const acceptedPackage = await repository.open(packageRoot);
  const accepted = acceptedPackage.changes.find(
    (change) => change.id === proposed.id,
  );
  assert.equal(accepted?.status, "accepted");
  assert.deepEqual(accepted?.decision?.actor, human);
  console.log(
    `Real xPrime MCP client check passed: proposed ${proposed.id}; human ${human.id} accepted ${acceptedPackage.manifest.revision}.`,
  );
} finally {
  await reviewServer.close().catch(() => undefined);
  await graph.dispose();
  await runtime.dispose();
}
