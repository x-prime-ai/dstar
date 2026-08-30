import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { digest } from "./delta.js";
import { atomic, exists, read, safe, syncDirectory } from "./io.js";
import type { State } from "./types.js";

export const STATE_LIMIT = 64 * 1024 * 1024;
const COUNT_LIMIT = 10000;
const JOURNAL_LIMIT = STATE_LIMIT * 2 + 1024 * 1024;
const collections = ["proposals", "comments"] as const;
type Collection = (typeof collections)[number];
type Records = Record<Collection, string[]>;
type Header = Omit<State, Collection> & {
  storage: "records-v1";
  proposalCount: number;
  commentCount: number;
};
type Baseline = { raw: string; records: Records; split: boolean };
type Undo = { collection: Collection; index: number; before: string | null };
type Journal = {
  format: "dstar-metadata-undo-v1";
  before: string;
  after: string;
  records: Undo[];
};

/** Numbered records preserve insertion order without a growing root index. */
function recordPath(
  meta: string,
  collection: Collection,
  index: number,
): string {
  if (
    !collections.includes(collection) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= COUNT_LIMIT
  )
    throw new Error("Invalid metadata record path");
  return join(meta, collection, `${String(index).padStart(8, "0")}.json`);
}

/** All writes/recovery are called with the Repository's exclusive lock held. */
export class MetadataStore {
  private readonly baselines = new WeakMap<State, Baseline>();
  constructor(private readonly meta: string) {}

  private get statePath(): string {
    return join(this.meta, "state.json");
  }
  private get journalPath(): string {
    return join(this.meta, "metadata-journal.json");
  }

  load(): State {
    if (exists(this.journalPath))
      throw new Error("Metadata recovery required; reopen through the Engine");
    const raw = read(this.statePath, STATE_LIMIT).toString("utf8");
    const parsed = JSON.parse(raw) as Omit<State, Collection> &
      Partial<Pick<State, Collection>> &
      Partial<Pick<Header, "storage" | "proposalCount" | "commentCount">>;
    if (!parsed || parsed.format !== "dstar-html-0.2-dev")
      throw new Error("Unsupported or corrupt DSTAR state");
    let state: State;
    const records: Records = { proposals: [], comments: [] };
    if (parsed.storage === undefined) {
      state = parsed as State;
      if (
        !Array.isArray(state.proposals) ||
        !Array.isArray(state.comments) ||
        state.proposals.length > COUNT_LIMIT ||
        state.comments.length > COUNT_LIMIT
      )
        throw new Error("Unsupported or corrupt DSTAR state");
      for (const collection of collections)
        records[collection] = state[collection].map((value) =>
          JSON.stringify(value),
        );
    } else {
      if (
        parsed.storage !== "records-v1" ||
        Buffer.byteLength(raw) > 4096 ||
        "proposals" in parsed ||
        "comments" in parsed
      )
        throw new Error("Unsupported metadata storage");
      const counts = {
        proposals: parsed.proposalCount,
        comments: parsed.commentCount,
      };
      let size = Buffer.byteLength(raw);
      for (const collection of collections) {
        const count = counts[collection];
        if (
          count === undefined ||
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > COUNT_LIMIT
        )
          throw new Error("Invalid metadata record count");
        for (let index = 0; index < count; index++) {
          const bytes = read(
            recordPath(this.meta, collection, index),
            STATE_LIMIT - size,
          );
          size += bytes.length;
          records[collection].push(bytes.toString("utf8"));
        }
      }
      state = {
        format: parsed.format,
        id: parsed.id,
        generation: parsed.generation,
        head: parsed.head,
        proposals: records.proposals.map(
          (raw) => JSON.parse(raw) as State["proposals"][number],
        ),
        comments: records.comments.map(
          (raw) => JSON.parse(raw) as State["comments"][number],
        ),
      };
    }
    this.baselines.set(state, {
      raw,
      records,
      split: parsed.storage === "records-v1",
    });
    return state;
  }

  save(state: State): void {
    if (exists(this.journalPath)) throw new Error("Metadata recovery required");
    let baseline = this.baselines.get(state);
    if (!baseline && exists(this.statePath)) {
      const current = this.load();
      if (current.id !== state.id || current.generation !== state.generation)
        throw new Error("Metadata state changed");
      baseline = this.baselines.get(current)!;
    }
    if (
      baseline &&
      read(this.statePath, STATE_LIMIT).toString("utf8") !== baseline.raw
    )
      throw new Error("Metadata state changed");
    const header: Header = {
      format: state.format,
      storage: "records-v1",
      id: state.id,
      generation: state.generation + 1,
      head: state.head,
      proposalCount: state.proposals.length,
      commentCount: state.comments.length,
    };
    if (!Number.isSafeInteger(header.generation))
      throw new Error("Invalid generation");
    const raw = JSON.stringify(header);
    if (Buffer.byteLength(raw) > 4096)
      throw new Error("Metadata header size limit exceeded");
    const records: Records = { proposals: [], comments: [] };
    const changes: (Undo & { after: string })[] = [];
    let size = Buffer.byteLength(raw);
    for (const collection of collections) {
      if (
        state[collection].length > COUNT_LIMIT ||
        state[collection].length < (baseline?.records[collection].length ?? 0)
      )
        throw new Error(
          "Metadata records cannot be removed or exceed their limit",
        );
      for (const [index, value] of state[collection].entries()) {
        const after = JSON.stringify(value);
        size += Buffer.byteLength(after);
        if (size > STATE_LIMIT) throw new Error("Metadata size limit exceeded");
        records[collection].push(after);
        const previous = baseline?.records[collection][index];
        if (baseline?.split && previous === after) continue;
        if (
          previous !== undefined &&
          (JSON.parse(previous) as { id: string }).id !== value.id
        )
          throw new Error(
            "Metadata record identities cannot be reordered or replaced",
          );
        const path = safe(recordPath(this.meta, collection, index));
        // Never overwrite an untracked record, including during legacy migration.
        const before =
          baseline?.split && previous !== undefined ? previous : null;
        if (before === null && exists(path))
          throw new Error(`Untracked metadata record: ${path}`);
        changes.push({ collection, index, before, after });
      }
    }
    // Creation writes an empty header first; subsequent proposals use the same
    // undo protocol as every other mutation.
    if (!baseline) {
      if (changes.length)
        throw new Error("Initialize empty metadata before adding records");
      atomic(this.statePath, raw);
    } else {
      const journal: Journal = {
        format: "dstar-metadata-undo-v1",
        before: digest(baseline.raw),
        after: digest(raw),
        records: changes.map(({ collection, index, before }) => ({
          collection,
          index,
          before,
        })),
      };
      const undo = JSON.stringify(journal);
      if (Buffer.byteLength(undo) > JOURNAL_LIMIT)
        throw new Error("Metadata journal size limit exceeded");
      atomic(this.journalPath, undo);
      for (const change of changes)
        atomic(
          recordPath(this.meta, change.collection, change.index),
          change.after,
        );
      // This small atomic replacement is the only commit point.
      atomic(this.statePath, raw);
      fs.unlinkSync(this.journalPath);
      syncDirectory(this.meta);
    }
    state.generation = header.generation;
    this.baselines.set(state, { raw, records, split: true });
  }

  recover(): void {
    if (!exists(this.journalPath)) return;
    const journal = JSON.parse(
      read(this.journalPath, JOURNAL_LIMIT).toString("utf8"),
    ) as Journal;
    if (
      !journal ||
      journal.format !== "dstar-metadata-undo-v1" ||
      !/^sha256:[a-f0-9]{64}$/.test(journal.before) ||
      !/^sha256:[a-f0-9]{64}$/.test(journal.after) ||
      !Array.isArray(journal.records) ||
      journal.records.length > COUNT_LIMIT * 2
    )
      throw new Error("Invalid metadata recovery journal");
    const seen = new Set<string>();
    // Validate every destination before touching any file.
    for (const change of journal.records) {
      if (
        !change ||
        (change.before !== null && typeof change.before !== "string")
      )
        throw new Error("Invalid metadata undo record");
      const path = safe(recordPath(this.meta, change.collection, change.index));
      if (seen.has(path)) throw new Error("Duplicate metadata undo record");
      seen.add(path);
    }
    const current = digest(read(this.statePath, STATE_LIMIT));
    if (current !== journal.before && current !== journal.after)
      throw new Error("Metadata journal does not match state");
    if (current === journal.before) {
      for (const change of journal.records) {
        const path = recordPath(this.meta, change.collection, change.index);
        if (change.before !== null) {
          const before = Buffer.from(change.before);
          // A failed record allocation can leave the old file intact. Do not
          // require another full allocation just to recover from ENOSPC.
          if (!exists(path) || !read(path, STATE_LIMIT).equals(before))
            atomic(path, before);
          else
            // A prior recovery may have renamed this file before being
            // interrupted. Persist that directory entry before clearing undo.
            syncDirectory(dirname(path));
        } else {
          if (exists(path)) {
            safe(path);
            if (!fs.lstatSync(path).isFile())
              throw new Error("Unsafe metadata rollback");
            fs.unlinkSync(path);
          }
          // Also sync an already-absent record after an interrupted unlink.
          if (exists(dirname(path))) syncDirectory(dirname(path));
        }
      }
    }
    // If state is the new header, all record writes preceded its durable commit.
    fs.unlinkSync(this.journalPath);
    syncDirectory(this.meta);
  }
}
