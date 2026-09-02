import assert from "node:assert/strict";
import test from "node:test";
import {
  decideProposal,
  initialVersionState,
  normalizeVersionState,
  revisionOf,
  validateCandidateFiles,
} from "./review-state.mjs";

const current = {
  revision: "sha256:base",
  html: '<main data-dstar-id="root">Base</main>',
  css: "main{}",
};

test("revisionOf is stable and covers both files", async () => {
  assert.equal(await revisionOf("a", "b"), await revisionOf("a", "b"));
  assert.notEqual(await revisionOf("a", "b"), await revisionOf("a", "c"));
});

test("candidate validation requires the supported complete file set", () => {
  assert.deepEqual(validateCandidateFiles([]), ["document.html is required"]);
  assert.deepEqual(
    validateCandidateFiles([
      { path: "document.html", content: "<main></main>" },
      { path: "asset.png", content: "x" },
    ]),
    ["unsupported files: asset.png"],
  );
  assert.deepEqual(
    validateCandidateFiles([
      { path: "document.html", content: "<main></main>" },
      { path: "styles.css", content: "main{}" },
    ]),
    [],
  );
});

test("only an explicit accepted decision changes the current revision", () => {
  const proposal = {
    id: "proposal-1",
    status: "pending",
    revision: "sha256:next",
    html: '<main data-dstar-id="root">Next</main>',
    css: "main{color:green}",
  };
  const state = { ...initialVersionState(current), proposals: [proposal] };
  const rejected = decideProposal(state, proposal.id, "rejected", "2026-09-02");
  assert.equal(rejected.current.revision, current.revision);
  const accepted = decideProposal(state, proposal.id, "accepted", "2026-09-02");
  assert.equal(accepted.current.revision, proposal.revision);
  assert.equal(accepted.history[0].revision, current.revision);
});

test("invalid persisted state falls back to the published document", () => {
  assert.deepEqual(
    normalizeVersionState({ schema: 0 }, current).current,
    current,
  );
});
