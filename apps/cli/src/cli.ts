import { randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  PackageCommands,
  PackageRepository,
  acceptGenesisDraft,
  createGenesisDraft,
  genesisProposalRevision,
  openPackage,
} from "@dstar/node";
import { parseIJson, type DstarActor, type DstarChange } from "@dstar/core";
import { serveDstarStdio } from "@dstar/mcp-server";
import { publishProjections } from "@dstar/render-html";
import { readFile } from "node:fs/promises";

export interface CliIo {
  readonly write: (message: string) => void;
  readonly error: (message: string) => void;
  readonly confirm: (message: string) => Promise<boolean>;
}

function usage(): string {
  return [
    "Usage:",
    "  dstar validate <package>",
    "  dstar inspect <package>",
    "  dstar history <package>",
    "  dstar show <package> --version <accepted-change-id>",
    "  dstar render <package> [--projection <id>]",
    "  dstar draft create <request-file>",
    "  dstar accept-genesis <draft>",
    "  dstar accept <package> <change-id>",
    "  dstar reject <package> <change-id>",
    "  dstar mcp document <package> --actor <agent-id>",
    "  dstar mcp genesis <draft> --actor <agent-id>",
  ].join("\n");
}

function required(value: string | undefined, label: string): string {
  if (!value || value.startsWith("--")) throw new Error(`${label} is required`);
  return value;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return required(args[index + 1], name);
}

function rejectUnknownOptions(
  args: readonly string[],
  allowed: readonly string[],
): void {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) continue;
    if (!allowed.includes(value)) throw new Error(`Unknown option ${value}`);
    index += 1;
  }
}

function requirePositionalCount(
  args: readonly string[],
  expected: number,
): void {
  let count = 0;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index]!.startsWith("--")) index += 1;
    else count += 1;
  }
  if (count !== expected) throw new Error("Unexpected command arguments");
}

function humanActor(actorId?: string): DstarActor {
  const id = actorId ?? `human:${userInfo().username}`;
  return { type: "human", id };
}

function runtimeRoot(): string {
  return resolve(
    process.env.DSTAR_RUNTIME_ROOT ?? join(homedir(), ".dstar", "runtime"),
  );
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function confirmInteractive(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Human decision commands require an interactive terminal");
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `${message} Type 'accept' to continue: `,
    );
    return answer === "accept";
  } finally {
    prompt.close();
  }
}

export const defaultIo: CliIo = {
  write: (message) => process.stdout.write(message),
  error: (message) => process.stderr.write(message),
  confirm: confirmInteractive,
};

export async function runCli(
  args: readonly string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const [verb, ...rest] = args;
  if (!verb || verb === "help" || verb === "--help") {
    io.write(`${usage()}\n`);
    return 0;
  }
  if (args.includes("--yes"))
    throw new Error("--yes is not supported for human decisions");

  if (verb === "validate" || verb === "inspect") {
    rejectUnknownOptions(rest, []);
    requirePositionalCount(rest, 1);
    const packageRoot = resolve(required(rest[0], "package"));
    const snapshot = await openPackage(packageRoot, {
      mode: verb === "inspect" ? "inspect" : "strict",
    });
    io.write(
      json({
        valid: snapshot.writable,
        snapshotId: snapshot.snapshotId,
        documentId: snapshot.manifest.id,
        revision: snapshot.manifest.revision,
        diagnostics: snapshot.diagnostics,
      }),
    );
    return snapshot.writable ? 0 : 1;
  }

  if (verb === "history") {
    rejectUnknownOptions(rest, []);
    requirePositionalCount(rest, 1);
    const repository = new PackageRepository(runtimeRoot());
    const snapshot = await repository.open(
      resolve(required(rest[0], "package")),
    );
    io.write(json(new PackageCommands(repository).history(snapshot)));
    return 0;
  }

  if (verb === "show") {
    rejectUnknownOptions(rest, ["--version"]);
    requirePositionalCount(rest, 1);
    const repository = new PackageRepository(runtimeRoot());
    const snapshot = await repository.open(
      resolve(required(rest[0], "package")),
    );
    const result = new PackageCommands(repository).showVersion(
      snapshot,
      required(option(rest, "--version"), "--version"),
    );
    io.write(json(result));
    return result.valid ? 0 : 1;
  }

  if (verb === "render") {
    rejectUnknownOptions(rest, ["--projection", "--runtime-root"]);
    requirePositionalCount(rest, 1);
    const packageRoot = resolve(required(rest[0], "package"));
    const repository = new PackageRepository(
      resolve(option(rest, "--runtime-root") ?? runtimeRoot()),
    );
    const snapshot = await repository.open(packageRoot);
    const projectionId = option(rest, "--projection");
    const result = await publishProjections(repository, snapshot, {
      ...(projectionId ? { projectionId } : {}),
    });
    io.write(
      json({
        snapshotId: result.snapshot.snapshotId,
        revision: result.snapshot.manifest.revision,
        projections: result.projections.map((projection) => ({
          id: projection.id,
          path: projection.path,
          projectionRevision: projection.revision,
          generatedFromRevision: projection.generatedFromRevision,
          reviewable: projection.reviewable,
        })),
        diagnostics: result.diagnostics,
      }),
    );
    return 0;
  }

  if (verb === "draft") {
    if (rest[0] !== "create")
      throw new Error("Only 'dstar draft create <request-file>' is supported");
    rejectUnknownOptions(rest.slice(1), []);
    requirePositionalCount(rest.slice(1), 1);
    const requestFile = resolve(required(rest[1], "request-file"));
    const draftRoot = join(
      dirname(requestFile),
      `${basename(requestFile)}.draft`,
    );
    await createGenesisDraft(requestFile, draftRoot);
    io.write(json({ draft: draftRoot }));
    return 0;
  }

  if (verb === "accept-genesis") {
    rejectUnknownOptions(rest, ["--actor"]);
    requirePositionalCount(rest, 1);
    const draftRoot = resolve(required(rest[0], "draft"));
    const proposal = parseIJson(
      await readFile(join(draftRoot, "proposal.json")),
    ).value as unknown as DstarChange;
    const expectedRevision = genesisProposalRevision(proposal);
    const actor = humanActor(option(rest, "--actor"));
    io.write(json({ proposal, expectedRevision }));
    if (
      !(await io.confirm(
        `Accept genesis ${proposal.id} at ${expectedRevision}?`,
      ))
    )
      return 2;
    const snapshot = await acceptGenesisDraft(
      draftRoot,
      actor,
      new Date().toISOString(),
      expectedRevision,
    );
    io.write(
      json({ package: snapshot.root, revision: snapshot.manifest.revision }),
    );
    return 0;
  }

  if (verb === "accept" || verb === "reject") {
    rejectUnknownOptions(
      rest,
      verb === "accept" ? ["--actor"] : ["--actor", "--reason"],
    );
    requirePositionalCount(rest, 2);
    const packageRoot = resolve(required(rest[0], "package"));
    const changeId = required(rest[1], "change-id");
    const repository = new PackageRepository(runtimeRoot());
    const commands = new PackageCommands(repository);
    const snapshot = await repository.open(packageRoot);
    const actor = humanActor(option(rest, "--actor"));
    const now = new Date().toISOString();
    if (verb === "accept") {
      const simulation = commands.simulateChange(snapshot, changeId);
      if (
        simulation.applicability !== "applicable" ||
        !simulation.resultRevision
      ) {
        io.error(json(simulation));
        return 1;
      }
      io.write(
        json({
          changeId,
          resultRevision: simulation.resultRevision,
          semanticDiff: simulation.semanticDiff,
          diagnostics: simulation.diagnostics,
        }),
      );
      if (
        !(await io.confirm(
          `Accept ${changeId} at ${simulation.resultRevision}?`,
        ))
      )
        return 2;
      const result = await commands.acceptChange(
        snapshot,
        changeId,
        actor,
        now,
        simulation.resultRevision,
        {
          expectedSnapshotId: snapshot.snapshotId,
          idempotencyKey: randomUUID(),
        },
      );
      io.write(
        json({
          snapshotId: result.snapshotId,
          revision: result.manifest.revision,
        }),
      );
      return 0;
    }
    io.write(
      json({
        change: snapshot.changes.find((candidate) => candidate.id === changeId),
      }),
    );
    if (!(await io.confirm(`Reject ${changeId}?`))) return 2;
    const result = await commands.rejectChange(
      snapshot,
      changeId,
      actor,
      now,
      option(rest, "--reason"),
      { expectedSnapshotId: snapshot.snapshotId, idempotencyKey: randomUUID() },
    );
    io.write(
      json({ snapshotId: result.snapshotId, changeId, status: "rejected" }),
    );
    return 0;
  }

  if (verb === "mcp") {
    const mode = rest[0];
    if (mode !== "document" && mode !== "genesis") {
      throw new Error("MCP mode must be document or genesis");
    }
    rejectUnknownOptions(rest.slice(1), ["--actor", "--runtime-root"]);
    requirePositionalCount(rest.slice(1), 1);
    const target = resolve(
      required(rest[1], mode === "document" ? "package" : "draft"),
    );
    const actorId = required(option(rest, "--actor"), "--actor");
    const selectedRuntimeRoot = resolve(
      option(rest, "--runtime-root") ?? runtimeRoot(),
    );
    try {
      await serveDstarStdio({
        broker:
          mode === "document"
            ? {
                mode,
                packageRoot: target,
                runtimeRoot: selectedRuntimeRoot,
                actorId,
              }
            : { mode, draftRoot: target, actorId },
        onerror: () => process.stderr.write("DSTAR_MCP_PROTOCOL_ERROR\n"),
      });
      return 0;
    } catch {
      io.error("DSTAR_MCP_START_FAILED\n");
      return 1;
    }
  }

  throw new Error(`Unknown command ${verb}\n${usage()}`);
}
