import { useState, type FormEvent } from "react";
import type { AnnotationView, SelectionCapture } from "../types.js";

interface ReviewRailProps {
  readonly capture?: SelectionCapture;
  readonly annotations: readonly AnnotationView[];
  readonly freshSelection: boolean;
  readonly onComment: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<boolean>;
  readonly onReply: (annotationId: string, body: string) => Promise<boolean>;
  readonly onResolve: (annotationId: string) => Promise<boolean>;
  readonly onDelegate: (
    annotationId: string,
    agentId: string,
    instruction: string,
  ) => Promise<boolean>;
}

function ThreadActions({
  annotationId,
  open,
  onReply,
  onResolve,
  onDelegate,
}: {
  readonly annotationId: string;
  readonly open: boolean;
  readonly onReply: ReviewRailProps["onReply"];
  readonly onResolve: ReviewRailProps["onResolve"];
  readonly onDelegate: ReviewRailProps["onDelegate"];
}) {
  const [reply, setReply] = useState("");
  const [agent, setAgent] = useState("agent_demo");
  const [instruction, setInstruction] = useState("");
  return (
    <div className="thread-actions">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (reply.trim())
            void onReply(annotationId, reply.trim()).then((saved) => {
              if (saved) setReply("");
            });
        }}
      >
        <label>
          Human reply
          <input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
        </label>
        <button className="button button-quiet" type="submit">
          Reply
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (agent.trim())
            void onDelegate(
              annotationId,
              agent.trim(),
              instruction.trim(),
            ).then((saved) => {
              if (saved) setInstruction("");
            });
        }}
      >
        <label>
          Agent ID
          <input
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
          />
        </label>
        <label>
          Supplemental instruction
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <button className="button button-accent" type="submit">
          Delegate separately
        </button>
      </form>
      {open ? (
        <button
          className="button button-quiet"
          onClick={() => void onResolve(annotationId)}
          type="button"
        >
          Resolve discussion
        </button>
      ) : null}
    </div>
  );
}

export function ReviewRail({
  capture,
  annotations,
  freshSelection,
  onComment,
  onReply,
  onResolve,
  onDelegate,
}: ReviewRailProps) {
  const [body, setBody] = useState("");
  const [purpose, setPurpose] = useState("discussion");
  const [scope, setScope] = useState("canonical");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!capture || !body.trim() || !freshSelection) return;
    const saved = await onComment({
      purpose,
      scope: capture.target.source === "document" ? "canonical" : scope,
      target: capture.target,
      ...(capture.canonicalTargets
        ? { canonicalTargets: capture.canonicalTargets }
        : {}),
      body: body.trim(),
      audience: ["human", "agent"],
    });
    if (saved) setBody("");
  };

  return (
    <aside className="review-rail" aria-labelledby="review-heading">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Portable discussion</p>
          <h2 id="review-heading">Review rail</h2>
        </div>
        <span className="count">
          {
            annotations.filter(({ annotation }) => annotation.status === "open")
              .length
          }
        </span>
      </header>
      <form className="composer" onSubmit={(event) => void submit(event)}>
        <div className="selection-quote">
          {capture ? (
            <>
              <span>{capture.sourceLabel}</span>
              <blockquote>{capture.exact}</blockquote>
            </>
          ) : (
            <p>Select text or choose a semantic object to comment.</p>
          )}
        </div>
        <label>
          Comment
          <textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add direction, a question, or discussion…"
          />
        </label>
        <div className="field-row">
          <label>
            Purpose
            <select
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            >
              <option value="discussion">Discussion</option>
              <option value="question">Question</option>
              <option value="change-request">Change request</option>
            </select>
          </label>
          {capture && capture.target.source !== "document" ? (
            <label>
              Scope
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="projection">Projection</option>
                <option value="canonical">Canonical</option>
                <option value="both">Both</option>
              </select>
            </label>
          ) : null}
        </div>
        <button
          className="button button-primary"
          disabled={!capture || !body.trim() || !freshSelection}
          type="submit"
        >
          Save comment
        </button>
      </form>
      <div className="thread-list">
        {annotations.map(({ annotation, resolution }) => (
          <article className="thread-card" key={annotation.id}>
            <div className="thread-meta">
              <span
                className={`status ${resolution.state === "exact" ? "status-ok" : "status-warning"}`}
              >
                {resolution.state}
              </span>
              <span>{annotation.purpose}</span>
              <span>{annotation.status}</span>
            </div>
            <h3>{annotation.id}</h3>
            <p>{annotation.body}</p>
            {(annotation.replies ?? []).map((reply) => (
              <blockquote key={reply.id}>
                <strong>{reply.author.id}</strong> · {reply.body}
              </blockquote>
            ))}
            <ThreadActions
              annotationId={annotation.id}
              open={annotation.status === "open"}
              onReply={onReply}
              onResolve={onResolve}
              onDelegate={onDelegate}
            />
          </article>
        ))}
      </div>
    </aside>
  );
}
