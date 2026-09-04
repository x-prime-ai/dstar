import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, sep } from "node:path";
import { atomic, exists, read, safe, syncDirectory } from "./io.js";
import { MetadataStore } from "./metadata.js";
import {
  decodeFile,
  digest,
  encodeFile,
  MAX_FILE,
  MAX_TOTAL,
  revision,
  revisionFromEntries,
} from "./delta.js";
import { filePath, validateHtml, validateTarget, reviewDiff } from "./html.js";
import type {
  Actor,
  Comment,
  Files,
  Proposal,
  Snapshot,
  State,
  Storage,
  Target,
} from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
function actorField(value: Actor, name: string): void {
  if (typeof value === "string") {
    textField(value, name, 200);
    return;
  }
  if (
    !value ||
    Object.keys(value).sort().join(",") !== "displayName,id,role" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.role) ||
    value.displayName !== value.displayName.trim() ||
    [...value.displayName].length < 1 ||
    [...value.displayName].length > 80 ||
    !/^[\p{L}\p{N}](?:[\p{L}\p{N} .,'’_-]*[\p{L}\p{N}])?$/u.test(
      value.displayName,
    )
  )
    throw new Error(`Invalid ${name}`);
}
function bounded(files: Files): Files {
  if (
    files.size > 512 ||
    [...files.values()].some((v) => v.length > MAX_FILE) ||
    [...files.values()].reduce((sum, v) => sum + v.length, 0) > MAX_TOTAL
  )
    throw new Error("Package resource limit exceeded");
  return files;
}
export function readCandidate(directory: string): Files {
  const root = safe(directory),
    files: Files = new Map();
  let entries = 0;
  const walk = (path: string, prefix: string): void => {
    for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
      if (++entries > 2048) throw new Error("Directory entry limit exceeded");
      const name = prefix + entry.name,
        full = join(path, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlink in candidate: ${name}`);
      if (entry.isDirectory()) {
        if (
          !(
            name === "assets" ||
            name === "styles" ||
            /^(assets|styles)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)
          ) ||
          name.split("/").length > 12 ||
          name.split("/").some((p) => p.startsWith("."))
        )
          throw new Error(`Unsupported directory: ${name}`);
        walk(full, `${name}/`);
      } else {
        filePath(name);
        files.set(name, read(full, MAX_FILE));
        bounded(files);
      }
    }
  };
  walk(root, "");
  validateHtml(files);
  return bounded(files);
}
function checkout(root: string): Files {
  const files: Files = new Map();
  let entries = 0;
  const walk = (path: string, prefix: string): void => {
    if (prefix.split("/").length > 14)
      throw new Error("Directory depth limit exceeded");
    safe(path);
    for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
      if (++entries > 2048) throw new Error("Directory entry limit exceeded");
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(path, entry.name), `${name}/`);
      else {
        filePath(name);
        files.set(name, read(join(path, entry.name), MAX_FILE));
        bounded(files);
      }
    }
  };
  for (const name of ["document.html", "styles.css"])
    if (exists(join(root, name)))
      files.set(name, read(join(root, name), MAX_FILE));
  for (const name of ["styles", "assets"])
    if (exists(join(root, name))) walk(join(root, name), `${name}/`);
  return bounded(files);
}
function validateState(value: State): State {
  if (
    !value ||
    value.format !== "dstar-html-0.2-dev" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    typeof value.id !== "string" ||
    !Array.isArray(value.proposals) ||
    !Array.isArray(value.comments) ||
    value.proposals.length > 10000 ||
    value.comments.length > 10000
  )
    throw new Error("Unsupported or corrupt DSTAR state");
  const ids = new Set<string>();
  const commentIds = new Set<string>();
  for (const c of value.comments) {
    if (
      !c ||
      !UUID.test(c.id) ||
      commentIds.has(c.id) ||
      !["open", "resolved"].includes(c.status) ||
      !Array.isArray(c.replies) ||
      typeof c.body !== "string" ||
      !c.target ||
      !HASH.test(c.target.revision)
    )
      throw new Error("Corrupt comment metadata");
    actorField(c.author, "comment author");
    for (const reply of c.replies) actorField(reply.author, "reply author");
    if (c.status === "resolved" && (c.resolvedAt || c.resolvedBy)) {
      if (!c.resolvedAt || !c.resolvedBy)
        throw new Error("Resolved comment has incomplete attribution");
      actorField(c.resolvedBy, "resolution actor");
    } else if (c.resolvedAt !== undefined || c.resolvedBy !== undefined) {
      throw new Error("Open comment has resolution attribution");
    }
    commentIds.add(c.id);
  }
  for (const p of value.proposals) {
    if (
      !p ||
      !/^[a-f0-9-]{36}$/.test(p.id) ||
      ids.has(p.id) ||
      !HASH.test(p.revision) ||
      (p.base !== null && !HASH.test(p.base)) ||
      !["pending", "accepted", "rejected"].includes(p.status) ||
      !Array.isArray(p.changes) ||
      p.changes.length > 1024 ||
      (p.motivatedBy !== undefined &&
        (!Array.isArray(p.motivatedBy) ||
          p.motivatedBy.length > 100 ||
          new Set(p.motivatedBy).size !== p.motivatedBy.length ||
          p.motivatedBy.some(
            (commentId) =>
              typeof commentId !== "string" ||
              !UUID.test(commentId) ||
              !commentIds.has(commentId),
          )))
    )
      throw new Error("Corrupt proposal metadata");
    actorField(p.author, "proposal author");
    if (p.decision) actorField(p.decision.actor, "decision actor");
    ids.add(p.id);
    const paths = new Set<string>();
    for (const c of p.changes) {
      filePath(c.path);
      if (
        paths.has(c.path) ||
        (c.base !== null && !HASH.test(c.base)) ||
        (c.result !== null && !HASH.test(c.result)) ||
        !Number.isSafeInteger(c.resultSize) ||
        c.resultSize < 0 ||
        c.resultSize > MAX_FILE
      )
        throw new Error("Corrupt file manifest");
      paths.add(c.path);
    }
    if (
      p.checkpoint &&
      (!Array.isArray(p.checkpoint) || p.checkpoint.length > 512)
    )
      throw new Error("Corrupt checkpoint");
  }
  if (
    value.head !== null &&
    !value.proposals.some((p) => p.id === value.head && p.status === "accepted")
  )
    throw new Error("Missing accepted head");
  return value;
}
export class Repository {
  readonly root: string;
  readonly meta: string;
  private readonly metadata: MetadataStore;
  private verifiedHead:
    { state: State; id: string | null; files: Files } | undefined;
  constructor(root: string) {
    this.root = safe(root);
    this.meta = join(this.root, ".dstar");
    this.metadata = new MetadataStore(this.meta);
    if (
      !exists(join(this.meta, "state.json")) &&
      (exists(join(this.root, "manifest.json")) ||
        exists(join(this.root, "document.json")))
    )
      throw new Error(
        "Legacy package is not supported by the HTML-first Engine; migration is not implemented",
      );
  }
  private objectPath(hash: string): string {
    if (!HASH.test(hash)) throw new Error("Invalid object digest");
    return join(this.meta, "objects", hash.slice(7));
  }
  private put(base: Buffer | undefined, bytes: Buffer): Storage {
    const encoded = encodeFile(base, bytes),
      path = this.objectPath(encoded.storage.object);
    if (!exists(path)) atomic(path, encoded.bytes);
    else if (!read(path, MAX_FILE * 2).equals(encoded.bytes))
      throw new Error("Corrupt existing object");
    return encoded.storage;
  }
  private decode(base: Buffer | undefined, storage: Storage): Buffer {
    if (
      !storage ||
      !Number.isSafeInteger(storage.size) ||
      storage.size < 0 ||
      storage.size > MAX_FILE * 2
    )
      throw new Error("Invalid storage reference");
    return decodeFile(
      base,
      storage,
      read(this.objectPath(storage.object), MAX_FILE * 2),
    );
  }
  load(): State {
    return validateState(this.metadata.load());
  }
  save(state: State): void {
    this.metadata.save(validateState(state));
  }
  materialize(state: State, id: string | null): Files {
    if (id === null) return new Map();
    // Only reuse a head verified during this same locked operation. A fresh
    // operation re-reads objects, so corruption is never hidden by a warm cache.
    if (this.verifiedHead?.state === state && this.verifiedHead.id === id)
      return new Map(
        [...this.verifiedHead.files].map(([path, bytes]) => [
          path,
          Buffer.from(bytes),
        ]),
      );
    const byId = new Map(state.proposals.map((p) => [p.id, p]));
    const chain: Proposal[] = [],
      seen = new Set<string>();
    let next: string | null = id;
    while (next !== null) {
      const p = byId.get(next);
      if (!p || seen.has(next)) throw new Error("Broken revision chain");
      if (chain.length && p.status !== "accepted")
        throw new Error("Unaccepted revision parent");
      seen.add(next);
      chain.push(p);
      if (p.checkpoint && p.status === "accepted") break;
      next = p.parent;
    }
    const files: Files = new Map();
    const entries = new Map<string, [string, string, number]>();
    for (const p of chain.reverse()) {
      if (p.checkpoint) {
        for (const c of p.checkpoint) {
          filePath(c.path);
          if (files.has(c.path) || c.storage.encoding !== "gzip-blob")
            throw new Error("Invalid checkpoint entry");
          const bytes = this.decode(undefined, c.storage);
          const hash = digest(bytes);
          if (hash !== c.digest || bytes.length !== c.size)
            throw new Error("Corrupt checkpoint file");
          files.set(c.path, bytes);
          entries.set(c.path, [c.path, hash, bytes.length]);
        }
      } else {
        if (
          (files.size ? revisionFromEntries([...entries.values()]) : null) !==
          p.base
        )
          throw new Error("Revision base mismatch");
        for (const c of p.changes) {
          const base = files.get(c.path);
          if ((entries.get(c.path)?.[1] ?? null) !== c.base)
            throw new Error("File delta base mismatch");
          if (c.result === null) {
            files.delete(c.path);
            entries.delete(c.path);
          } else {
            if (!c.storage) throw new Error("Missing file storage");
            const bytes = this.decode(base, c.storage);
            const hash = digest(bytes);
            if (hash !== c.result || bytes.length !== c.resultSize)
              throw new Error("File delta result mismatch");
            files.set(c.path, bytes);
            entries.set(c.path, [c.path, hash, bytes.length]);
          }
        }
      }
      bounded(files);
      if (revisionFromEntries([...entries.values()]) !== p.revision)
        throw new Error("Candidate revision mismatch");
    }
    return files;
  }
  private install(files: Files, touched: string[]): void {
    touched.forEach(filePath);
    const deepestFirst = (a: string, b: string): number =>
      b.split("/").length - a.split("/").length;
    const directories = new Set<string>();
    // Delete only obsolete files named by this transaction, never an arbitrary
    // directory subtree. Do this before writes in both commit and recovery.
    for (const path of touched
      .filter((path) => !files.has(path))
      .sort(deepestFirst)) {
      const full = safe(join(this.root, path));
      if (exists(full) && fs.lstatSync(full).isFile()) {
        fs.unlinkSync(full);
        syncDirectory(dirname(full));
      } else if (exists(full) && !fs.lstatSync(full).isDirectory())
        throw new Error("Unsafe checkout removal");
      for (let directory = path; directory.includes("/");) {
        directory = directory.slice(0, directory.lastIndexOf("/"));
        directories.add(directory);
      }
    }
    // An old directory may need to become a file. Remove only empty known
    // ancestors; unknown files make the operation fail closed, not disappear.
    for (const path of touched) if (files.has(path)) directories.add(path);
    for (const path of [...directories].sort(deepestFirst)) {
      const full = safe(join(this.root, path));
      if (
        exists(full) &&
        fs.lstatSync(full).isDirectory() &&
        !fs.readdirSync(full).length
      ) {
        fs.rmdirSync(full);
        syncDirectory(dirname(full));
      }
    }
    for (const path of touched) {
      const bytes = files.get(path);
      if (bytes) atomic(safe(join(this.root, path)), bytes);
    }
  }
  private recover(state: State): void {
    const path = join(this.meta, "journal.json");
    if (!exists(path)) return;
    const data = JSON.parse(read(path, 512 * 1024).toString("utf8")) as {
      paths: string[];
    };
    if (!Array.isArray(data.paths) || data.paths.length > 1024)
      throw new Error("Invalid checkout recovery journal");
    data.paths.forEach(filePath);
    this.install(this.materialize(state, state.head), data.paths);
    fs.unlinkSync(path);
    syncDirectory(this.meta);
  }
  transaction<T>(fn: (state: State) => T, create = false): T {
    if (create && !exists(this.meta)) {
      if (exists(this.root) && fs.readdirSync(this.root).length)
        throw new Error("New DSTAR destination must be empty");
      fs.mkdirSync(this.meta, { recursive: true });
    }
    safe(this.meta);
    const lock = join(this.meta, "write.lock");
    let fd: number;
    try {
      fd = fs.openSync(lock, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          `Package locked: ${lock}. If its process has exited, remove only this lock and reopen for recovery.`,
        );
      throw error;
    }
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
      fs.fsyncSync(fd);
      this.metadata.recover();
      if (create && !exists(join(this.meta, "state.json")))
        this.save({
          format: "dstar-html-0.2-dev",
          id: randomUUID(),
          generation: 0,
          head: null,
          proposals: [],
          comments: [],
        });
      const state = this.load();
      this.recover(state);
      const expected = this.materialize(state, state.head),
        actual = checkout(this.root);
      if (revision(expected) !== revision(actual))
        throw new Error(
          "Accepted checkout changed outside DSTAR; restore it or use a separate candidate directory",
        );
      this.verifiedHead = { state, id: state.head, files: expected };
      return fn(state);
    } finally {
      this.verifiedHead = undefined;
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
  snapshot(id?: string): Snapshot {
    return this.transaction((state) => {
      const selected = id ?? state.head;
      const proposal =
        selected === null
          ? undefined
          : state.proposals.find(
              (p) => p.id === selected || p.revision === selected,
            );
      if (selected !== null && !proposal)
        throw new Error("Unknown revision or proposal");
      const files = this.materialize(state, proposal?.id ?? null);
      return {
        state,
        stateId: digest(JSON.stringify(state)),
        revision: proposal?.revision ?? null,
        files,
        index: files.size ? validateHtml(files) : null,
      };
    });
  }
  propose(args: {
    candidate: string;
    base: string | null;
    request: string;
    author: Actor;
    key: string;
    commentIds?: string[];
  }): Proposal {
    const candidate = safe(args.candidate);
    if (
      candidate === this.root ||
      candidate.startsWith(this.root + sep) ||
      this.root.startsWith(candidate + sep)
    )
      throw new Error(
        "Candidate and accepted package must be separate directories",
      );
    const files = readCandidate(candidate),
      result = revision(files);
    textField(args.request, "request");
    actorField(args.author, "author");
    textField(args.key, "key", 200);
    if (
      args.commentIds !== undefined &&
      (!Array.isArray(args.commentIds) ||
        args.commentIds.length < 1 ||
        args.commentIds.length > 100 ||
        new Set(args.commentIds).size !== args.commentIds.length ||
        args.commentIds.some(
          (commentId) => typeof commentId !== "string" || !UUID.test(commentId),
        ))
    )
      throw new Error("Invalid motivating comment IDs");
    const motivatedBy = [...(args.commentIds ?? [])].sort();
    return this.transaction((state) => {
      const command = digest(
        JSON.stringify(
          motivatedBy.length
            ? [args.base, result, args.request, args.author, motivatedBy]
            : [args.base, result, args.request, args.author],
        ),
      );
      const previous = state.proposals.find((p) => p.key === args.key);
      if (previous) {
        if (previous.command !== command)
          throw new Error(
            "Idempotency key already used for a different proposal",
          );
        return previous;
      }
      for (const commentId of motivatedBy) {
        const comment = state.comments.find((entry) => entry.id === commentId);
        if (!comment) throw new Error("Unknown motivating comment");
        if (comment.status !== "open")
          throw new Error("Motivating comment is no longer open");
      }
      const base = this.materialize(state, state.head);
      if ((base.size ? revision(base) : null) !== args.base)
        throw new Error("Stale base: re-read head and create a new proposal");
      if (args.base === result) throw new Error("No content changes");
      const changes: Proposal["changes"] = [];
      for (const path of [
        ...new Set([...base.keys(), ...files.keys()]),
      ].sort()) {
        const a = base.get(path),
          b = files.get(path);
        if (a && b && a.equals(b)) continue;
        changes.push({
          path,
          base: a ? digest(a) : null,
          result: b ? digest(b) : null,
          resultSize: b?.length ?? 0,
          ...(b ? { storage: this.put(a, b) } : {}),
        });
      }
      const p: Proposal = {
        id: randomUUID(),
        base: args.base,
        parent: state.head,
        revision: result,
        request: args.request,
        ...(motivatedBy.length ? { motivatedBy } : {}),
        author: args.author,
        key: args.key,
        command,
        createdAt: new Date().toISOString(),
        status: "pending",
        changes,
        diff: reviewDiff(base, files, state.comments),
      };
      state.proposals.push(p);
      this.materialize(state, p.id);
      this.save(state);
      return p;
    }, true);
  }
  comment(args: { target: Target; body: string; author: Actor }): Comment {
    textField(args.body, "comment");
    actorField(args.author, "author");
    return this.transaction((state) => {
      const p = state.proposals.find(
        (p) => p.revision === args.target.revision,
      );
      if (!p) throw new Error("Unknown comment revision");
      validateTarget(validateHtml(this.materialize(state, p.id)), args.target);
      const comment: Comment = {
        id: randomUUID(),
        ...args,
        createdAt: new Date().toISOString(),
        status: "open",
        replies: [],
      };
      state.comments.push(comment);
      this.save(state);
      return comment;
    });
  }
  reply(
    id: string,
    body: string,
    author: Actor,
    key?: string,
    expectedState?: string,
  ): Comment {
    textField(body, "reply");
    actorField(author, "author");
    if (key !== undefined) textField(key, "key", 200);
    return this.transaction((state) => {
      if (key !== undefined) {
        for (const comment of state.comments) {
          const previous = comment.replies.find((r) => r.key === key);
          if (!previous) continue;
          if (
            comment.id !== id ||
            previous.body !== body ||
            JSON.stringify(previous.author) !== JSON.stringify(author)
          )
            throw new Error(
              "Idempotency key already used for a different reply",
            );
          return comment;
        }
      }
      if (
        expectedState !== undefined &&
        digest(JSON.stringify(state)) !== expectedState
      )
        throw new Error("Review state changed; refresh before replying");
      const c = state.comments.find((c) => c.id === id);
      if (!c) throw new Error("Unknown comment");
      c.replies.push({
        id: randomUUID(),
        body,
        author,
        ...(key === undefined ? {} : { key }),
        createdAt: new Date().toISOString(),
      });
      this.save(state);
      return c;
    });
  }
  decide(
    id: string,
    action: "accept" | "reject",
    expectedRevision: string,
    expectedState: string,
    actor: Actor,
  ): Proposal {
    actorField(actor, "actor");
    return this.transaction((state) => {
      if (digest(JSON.stringify(state)) !== expectedState)
        throw new Error("Review state changed; refresh before deciding");
      const p = state.proposals.find((p) => p.id === id);
      if (!p || p.status !== "pending" || p.revision !== expectedRevision)
        throw new Error("Candidate changed or already decided");
      if (action === "accept" && p.parent !== state.head)
        throw new Error("Stale proposal base; a new proposal is required");
      p.status = action === "accept" ? "accepted" : "rejected";
      p.decision = { action, actor, at: new Date().toISOString() };
      if (action === "reject") {
        this.save(state);
        return p;
      }
      const files = this.materialize(state, p.id);
      validateHtml(files);
      const old = this.materialize(state, state.head);
      if (
        state.proposals.filter((p) => p.status === "accepted").length % 20 ===
        0
      )
        p.checkpoint = [...files].map(([path, bytes]) => ({
          path,
          digest: digest(bytes),
          size: bytes.length,
          storage: this.put(undefined, bytes),
        }));
      const touched = [...new Set([...old.keys(), ...files.keys()])].filter(
        (path) => {
          const before = old.get(path),
            after = files.get(path);
          return !before || !after || !before.equals(after);
        },
      );
      atomic(
        join(this.meta, "journal.json"),
        JSON.stringify({ paths: touched }),
      );
      this.install(files, touched);
      state.head = p.id;
      this.save(state);
      fs.unlinkSync(join(this.meta, "journal.json"));
      syncDirectory(this.meta);
      return p;
    });
  }
  resolveComment(
    id: string,
    expectedState: string,
    actor: Actor = "human",
  ): Comment {
    actorField(actor, "actor");
    return this.transaction((state) => {
      if (digest(JSON.stringify(state)) !== expectedState)
        throw new Error("Review state changed; refresh");
      const c = state.comments.find((c) => c.id === id);
      if (!c) throw new Error("Unknown comment");
      if (c.status !== "open") throw new Error("Comment is already resolved");
      c.status = "resolved";
      c.resolvedAt = new Date().toISOString();
      c.resolvedBy = actor;
      this.save(state);
      return c;
    });
  }
  export(
    directory: string,
    id?: string,
  ): { revision: string | null; directory: string } {
    const out = safe(directory);
    if (exists(out) && fs.readdirSync(out).length)
      throw new Error("Export destination must be empty");
    if (
      out === this.root ||
      out.startsWith(this.root + sep) ||
      this.root.startsWith(out + sep)
    )
      throw new Error("Export destination must be separate from package");
    const snapshot = this.snapshot(id);
    fs.mkdirSync(out, { recursive: true });
    for (const [path, bytes] of snapshot.files) atomic(join(out, path), bytes);
    return { revision: snapshot.revision, directory: out };
  }
}
export function textField(value: string, name: string, limit = 20000): void {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`Invalid ${name}`);
}
