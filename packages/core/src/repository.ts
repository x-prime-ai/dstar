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
import {
  filePath,
  validateHtml,
  validateTarget,
  reviewDiff,
  resolveTarget,
} from "./html.js";
import type {
  Actor,
  Comment,
  CreateRevisionRequestInput,
  Files,
  Proposal,
  RevisionRequest,
  Snapshot,
  State,
  Storage,
  Target,
  UpdateRevisionRequestInput,
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
function timestampField(value: string, name: string): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new Error(`Invalid ${name}`);
}
function targetField(value: Target, name: string): void {
  if (
    !value ||
    !HASH.test(value.revision) ||
    typeof value.element !== "string" ||
    !value.element ||
    !value.selector ||
    typeof value.selector !== "object"
  )
    throw new Error(`Invalid ${name}`);
  const range = (entry: {
    start: number;
    end: number;
    unit: string;
    exact: string;
    prefix?: string;
    suffix?: string;
  }): void => {
    if (
      !Number.isSafeInteger(entry.start) ||
      !Number.isSafeInteger(entry.end) ||
      entry.start < 0 ||
      entry.end <= entry.start ||
      entry.unit !== "unicode-code-point" ||
      typeof entry.exact !== "string" ||
      !entry.exact ||
      (entry.prefix !== undefined && typeof entry.prefix !== "string") ||
      (entry.suffix !== undefined && typeof entry.suffix !== "string")
    )
      throw new Error(`Invalid ${name}`);
  };
  if (value.selector.type === "element") return;
  if (value.selector.type === "text-range") {
    range(value.selector);
    return;
  }
  if (
    value.selector.type !== "text-ranges" ||
    !Array.isArray(value.selector.ranges) ||
    value.selector.ranges.length < 1 ||
    value.selector.ranges.length > 100
  )
    throw new Error(`Invalid ${name}`);
  for (const entry of value.selector.ranges) {
    if (!entry || typeof entry.element !== "string" || !entry.element)
      throw new Error(`Invalid ${name}`);
    range(entry);
  }
}
function replyFields(replies: Comment["replies"], name: string): void {
  if (!Array.isArray(replies) || replies.length > 10000)
    throw new Error(`Invalid ${name}`);
  const ids = new Set<string>();
  for (const reply of replies) {
    if (
      !reply ||
      !UUID.test(reply.id) ||
      ids.has(reply.id) ||
      (reply.key !== undefined &&
        (typeof reply.key !== "string" ||
          !reply.key.trim() ||
          reply.key.length > 200))
    )
      throw new Error(`Invalid ${name}`);
    textField(reply.body, `${name} body`);
    actorField(reply.author, `${name} author`);
    timestampField(reply.createdAt, `${name} timestamp`);
    ids.add(reply.id);
  }
}
function requestProse(instruction: string): string {
  return instruction || "Address selected review feedback";
}
function requestCommand(input: {
  base: string | null;
  instruction: string;
  commentIds: string[];
  requester: Actor;
}): string {
  return digest(
    JSON.stringify([
      input.base,
      input.instruction,
      requestProse(input.instruction),
      input.commentIds,
      input.requester,
    ]),
  );
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
    !Array.isArray(value.revisionRequests) ||
    value.proposals.length > 10000 ||
    value.comments.length > 10000 ||
    value.revisionRequests.length > 10000
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
    textField(c.body, "comment");
    timestampField(c.createdAt, "comment timestamp");
    targetField(c.target, "comment target");
    replyFields(c.replies, "comment replies");
    if (c.status === "resolved" && (c.resolvedAt || c.resolvedBy)) {
      if (!c.resolvedAt || !c.resolvedBy)
        throw new Error("Resolved comment has incomplete attribution");
      actorField(c.resolvedBy, "resolution actor");
    } else if (c.resolvedAt !== undefined || c.resolvedBy !== undefined) {
      throw new Error("Open comment has resolution attribution");
    }
    commentIds.add(c.id);
  }
  const requestIds = new Set<string>();
  const requestKeys = new Set<string>();
  const requestById = new Map<string, RevisionRequest>();
  for (const request of value.revisionRequests) {
    if (
      !request ||
      !UUID.test(request.id) ||
      requestIds.has(request.id) ||
      (request.base !== null && !HASH.test(request.base)) ||
      typeof request.instruction !== "string" ||
      request.instruction.length > 20000 ||
      typeof request.request !== "string" ||
      !request.request.trim() ||
      request.request.length > 20000 ||
      request.request !== requestProse(request.instruction) ||
      !Array.isArray(request.commentIds) ||
      request.commentIds.length > 100 ||
      new Set(request.commentIds).size !== request.commentIds.length ||
      request.commentIds.some(
        (id) => typeof id !== "string" || !UUID.test(id) || !commentIds.has(id),
      ) ||
      request.commentIds.some(
        (id, index) => index > 0 && request.commentIds[index - 1]! >= id,
      ) ||
      (!request.instruction.trim() && request.commentIds.length === 0) ||
      !Array.isArray(request.feedback) ||
      request.feedback.length !== request.commentIds.length ||
      typeof request.key !== "string" ||
      !request.key.trim() ||
      request.key.length > 200 ||
      requestKeys.has(request.key) ||
      !HASH.test(request.command) ||
      ![
        "submitted",
        "running",
        "returned",
        "failed",
        "expired",
        "conflicted",
      ].includes(request.status) ||
      !Number.isSafeInteger(request.attempt) ||
      request.attempt < 0 ||
      (request.attempt === 0) !== (request.attemptId === undefined) ||
      (request.attemptId !== undefined &&
        (typeof request.attemptId !== "string" ||
          !request.attemptId.trim() ||
          request.attemptId.length > 200)) ||
      (request.proposalId !== undefined && !UUID.test(request.proposalId)) ||
      (request.status === "returned") !== (request.proposalId !== undefined) ||
      ["failed", "expired", "conflicted"].includes(request.status) !==
        (request.error !== undefined) ||
      (request.error !== undefined &&
        (typeof request.error !== "string" ||
          !request.error.trim() ||
          request.error.length > 20000)) ||
      request.command !== requestCommand(request)
    )
      throw new Error("Corrupt revision request metadata");
    textField(request.request, "revision request prose");
    actorField(request.requester, "revision requester");
    timestampField(request.createdAt, "revision request timestamp");
    timestampField(request.updatedAt, "revision request update timestamp");
    if (request.updatedAt < request.createdAt)
      throw new Error("Corrupt revision request metadata");
    for (const [index, feedback] of request.feedback.entries()) {
      if (
        !feedback ||
        feedback.id !== request.commentIds[index] ||
        feedback.status !== "open"
      )
        throw new Error("Corrupt revision request feedback");
      textField(feedback.body, "revision request feedback body");
      actorField(feedback.author, "revision request feedback author");
      timestampField(feedback.createdAt, "revision request feedback timestamp");
      targetField(feedback.target, "revision request feedback target");
      replyFields(feedback.replies, "revision request feedback replies");
      const source = value.comments.find(
        (comment) => comment.id === feedback.id,
      );
      if (
        !source ||
        source.body !== feedback.body ||
        source.createdAt !== feedback.createdAt ||
        JSON.stringify(source.author) !== JSON.stringify(feedback.author) ||
        JSON.stringify(source.target) !== JSON.stringify(feedback.target) ||
        feedback.replies.length > source.replies.length ||
        JSON.stringify(source.replies.slice(0, feedback.replies.length)) !==
          JSON.stringify(feedback.replies)
      )
        throw new Error("Corrupt revision request feedback snapshot");
    }
    requestIds.add(request.id);
    requestKeys.add(request.key);
    requestById.set(request.id, request);
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
    if (p.requestId !== undefined) {
      if (!UUID.test(p.requestId)) throw new Error("Corrupt proposal metadata");
      const request = requestById.get(p.requestId);
      if (
        !request ||
        request.proposalId !== p.id ||
        request.status !== "returned" ||
        p.base !== request.base ||
        p.request !== request.request ||
        JSON.stringify(p.motivatedBy ?? []) !==
          JSON.stringify(request.commentIds)
      )
        throw new Error("Corrupt linked revision proposal");
    }
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
  for (const request of value.revisionRequests)
    if (
      request.proposalId !== undefined &&
      !value.proposals.some(
        (proposal) =>
          proposal.id === request.proposalId &&
          proposal.requestId === request.id,
      )
    )
      throw new Error("Missing linked revision proposal");
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
          revisionRequests: [],
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
  createRevisionRequest(args: CreateRevisionRequestInput): RevisionRequest {
    if (args.base !== null && !HASH.test(args.base))
      throw new Error("Invalid revision request base");
    actorField(args.requester, "requester");
    textField(args.key, "key", 200);
    const instruction = args.instruction?.trim() ? args.instruction : "";
    if (instruction.length > 20000)
      throw new Error("Invalid revision request instruction");
    if (
      args.commentIds !== undefined &&
      (!Array.isArray(args.commentIds) ||
        args.commentIds.length > 100 ||
        new Set(args.commentIds).size !== args.commentIds.length ||
        args.commentIds.some(
          (commentId) => typeof commentId !== "string" || !UUID.test(commentId),
        ))
    )
      throw new Error("Invalid revision request comment IDs");
    const commentIds = [...(args.commentIds ?? [])].sort();
    if (!instruction && !commentIds.length)
      throw new Error("A revision request needs feedback or an instruction");
    const command = requestCommand({
      base: args.base,
      instruction,
      commentIds,
      requester: args.requester,
    });
    return this.transaction((state) => {
      const previous = state.revisionRequests.find(
        (request) => request.key === args.key,
      );
      if (previous) {
        if (previous.command !== command)
          throw new Error(
            "Idempotency key already used for a different revision request",
          );
        return previous;
      }
      const baseFiles = this.materialize(state, state.head);
      if ((baseFiles.size ? revision(baseFiles) : null) !== args.base)
        throw new Error(
          "Stale base: re-read head and create a new revision request",
        );
      const index = baseFiles.size ? validateHtml(baseFiles) : null;
      const feedback = commentIds.map((commentId) => {
        const comment = state.comments.find((entry) => entry.id === commentId);
        if (!comment) throw new Error("Unknown revision request comment");
        if (comment.status !== "open")
          throw new Error("Revision request comment is no longer open");
        if (!index)
          throw new Error("Revision request comment has no accepted base");
        const resolution = resolveTarget(index, comment.target);
        if (!["exact", "recovered"].includes(resolution.status))
          throw new Error(
            `Revision request comment anchor is ${resolution.status}`,
          );
        return JSON.parse(
          JSON.stringify({
            id: comment.id,
            target: comment.target,
            body: comment.body,
            author: comment.author,
            createdAt: comment.createdAt,
            replies: comment.replies,
            status: comment.status,
          }),
        ) as RevisionRequest["feedback"][number];
      });
      const now = new Date().toISOString();
      const request: RevisionRequest = {
        id: randomUUID(),
        base: args.base,
        instruction,
        request: requestProse(instruction),
        commentIds,
        feedback,
        requester: args.requester,
        createdAt: now,
        key: args.key,
        command,
        status: "submitted",
        attempt: 0,
        updatedAt: now,
      };
      state.revisionRequests.push(request);
      this.save(state);
      return request;
    });
  }
  updateRevisionRequest(
    id: string,
    args: UpdateRevisionRequestInput,
  ): RevisionRequest {
    if (!UUID.test(id)) throw new Error("Invalid revision request ID");
    if (
      !["submitted", "running", "failed", "expired", "conflicted"].includes(
        args.status,
      )
    )
      throw new Error("Invalid revision request status");
    textField(args.attemptId, "attempt ID", 200);
    if (args.expectedStateId !== undefined && !HASH.test(args.expectedStateId))
      throw new Error("Invalid expected state ID");
    const failed = ["failed", "expired", "conflicted"].includes(args.status);
    if (failed)
      textField(args.error as string, "revision request error", 20000);
    else if (args.error !== undefined)
      throw new Error("Only a terminal invocation state can have an error");
    return this.transaction((state) => {
      const request = state.revisionRequests.find((entry) => entry.id === id);
      if (!request) throw new Error("Unknown revision request");
      // Returned is terminal. A late host callback reconciles to the already
      // stored request/proposal instead of changing or duplicating either.
      if (request.status === "returned") return request;
      if (request.attemptId === args.attemptId) {
        if (request.status === args.status && request.error === args.error)
          return request;
        if (request.status === "submitted" && args.status === "running") {
          request.status = "running";
          request.updatedAt = new Date().toISOString();
          this.save(state);
          return request;
        }
        if (request.status !== "running" && request.status !== "submitted")
          throw new Error("Invocation attempt is already complete");
        if (!failed)
          throw new Error("Invocation attempt cannot move backwards");
        request.status = args.status;
        request.error = args.error!;
        request.updatedAt = new Date().toISOString();
        this.save(state);
        return request;
      }
      if (request.attemptId !== undefined && failed)
        throw new Error("Invocation attempt was superseded");
      if (
        request.attemptId !== undefined &&
        ["submitted", "running"].includes(request.status)
      )
        throw new Error("A revision request attempt is already active");
      if (request.status === "conflicted")
        throw new Error("A conflicted revision request must be replaced");
      if (
        args.expectedStateId !== undefined &&
        digest(JSON.stringify(state)) !== args.expectedStateId
      )
        throw new Error("Review state changed; refresh before retrying");
      if (failed && request.attemptId !== undefined)
        throw new Error("A failure must identify the current attempt");
      if (failed && request.attempt !== 0)
        throw new Error("Invocation attempt was superseded");
      request.attempt += 1;
      request.attemptId = args.attemptId;
      request.status = args.status;
      request.updatedAt = new Date().toISOString();
      if (failed) request.error = args.error!;
      else delete request.error;
      this.save(state);
      return request;
    });
  }
  propose(args: {
    candidate: string;
    base: string | null;
    request: string;
    author: Actor;
    key: string;
    commentIds?: string[];
    requestId?: string;
    attemptId?: string;
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
    if (args.requestId !== undefined && !UUID.test(args.requestId))
      throw new Error("Invalid revision request ID");
    if (args.attemptId !== undefined)
      textField(args.attemptId, "attempt ID", 200);
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
      const request =
        args.requestId === undefined
          ? undefined
          : state.revisionRequests.find((entry) => entry.id === args.requestId);
      if (args.requestId !== undefined && !request)
        throw new Error("Unknown revision request");
      if (request) {
        if (
          args.base !== request.base ||
          args.request !== request.request ||
          JSON.stringify(motivatedBy) !== JSON.stringify(request.commentIds)
        )
          throw new Error("Proposal does not match its revision request");
        if (args.attemptId !== request.attemptId)
          throw new Error("Invocation attempt was superseded");
      } else if (args.attemptId !== undefined) {
        throw new Error("An attempt ID requires a revision request");
      }
      const command = digest(
        JSON.stringify(
          motivatedBy.length
            ? [
                args.base,
                result,
                args.request,
                args.author,
                motivatedBy,
                ...(request ? [request.id] : []),
              ]
            : [
                args.base,
                result,
                args.request,
                args.author,
                ...(request ? [request.id] : []),
              ],
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
      if (request?.proposalId) {
        const previousForRequest = state.proposals.find(
          (proposal) => proposal.id === request.proposalId,
        );
        if (!previousForRequest)
          throw new Error("Missing linked revision proposal");
        if (previousForRequest.command !== command)
          throw new Error("Revision request already returned a proposal");
        return previousForRequest;
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
        ...(request ? { requestId: request.id } : {}),
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
      if (request) {
        request.status = "returned";
        request.proposalId = p.id;
        request.updatedAt = new Date().toISOString();
        delete request.error;
      }
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
