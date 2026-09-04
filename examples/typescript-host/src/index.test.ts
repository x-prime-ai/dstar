import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import type { ActorIdentity } from "@dstar/core";

import { openDocument } from "./index.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0).reverse())
    rmSync(path, { recursive: true, force: true });
});

const owner: ActorIdentity & { role: "owner" } = {
  id: "owner-1",
  displayName: "Document Owner",
  role: "owner",
};
const reviewer = {
  id: "reviewer-1",
  displayName: "Review Partner",
  role: "reviewer" as const,
};

function candidate(root: string, text: string): string {
  const directory = join(root, `candidate-${text}`);
  mkdirSync(directory);
  writeFileSync(
    join(directory, "document.html"),
    `<!doctype html><html><head><title>Example</title></head><body><h1 data-dstar-id="title">${text}</h1></body></html>`,
  );
  return directory;
}

it("covers the complete host collaboration lifecycle", () => {
  const temporary = mkdtempSync(join(tmpdir(), "dstar-host-example-"));
  cleanup.push(temporary);
  const packageRoot = join(temporary, "example.dstar");
  const document = openDocument(packageRoot);

  const genesis = document.propose({
    candidate: candidate(temporary, "First"),
    base: null,
    request: "Create the document",
    author: { id: "agent-1", displayName: "Writer Agent", role: "agent" },
    key: "genesis",
  });
  let state = document.snapshot();
  document.decide(genesis.id, "accept", genesis.revision, state.stateId, owner);

  const comment = document.comment({
    target: {
      revision: genesis.revision,
      element: "title",
      selector: { type: "element" },
    },
    body: "Please revise this heading",
    author: reviewer,
  });
  state = document.snapshot();
  document.reply(
    comment.id,
    "I will address it",
    owner,
    "reply-1",
    state.stateId,
  );

  const update = document.propose({
    candidate: candidate(temporary, "Second"),
    base: genesis.revision,
    request: "Revise the heading",
    author: { id: "agent-1", displayName: "Writer Agent", role: "agent" },
    key: "update-1",
    commentIds: [comment.id],
  });
  state = document.snapshot();
  expect(
    document.decide(update.id, "reject", update.revision, state.stateId, owner)
      .status,
  ).toBe("rejected");

  state = document.snapshot();
  expect(document.resolveComment(comment.id, state.stateId, owner).status).toBe(
    "resolved",
  );

  const output = join(temporary, "exported");
  expect(document.export(output).revision).toBe(genesis.revision);
});
