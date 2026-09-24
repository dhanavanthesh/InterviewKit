"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Kit, Question, QuestionCategory } from "@interview-kit/schema";
import { useState, type FormEvent } from "react";
import { Button, Dialog, EmptyState, Notice } from "../ui";
import { InlineText, ReorderButtons } from "../editable";
import type { Writer } from "./kit-builder";

const categories: QuestionCategory[] = ["technical", "behavioural", "system-design", "company-fit"];
const label = (category: string) => category.replaceAll("-", " ").replaceAll("_", " ");

function SortableQuestion({
  question,
  children,
}: {
  question: Question;
  children: React.ReactNode;
}) {
  const sortable = useSortable({ id: question.id });
  return (
    <article
      ref={sortable.setNodeRef}
      className={`q-row${sortable.isDragging ? " is-dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <button
        className="grip"
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`Drag to reorder ${question.prompt}`}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
          {[3, 8, 13].map((y) => (
            <g key={y}>
              <circle cx="2.5" cy={y} r="1.4" />
              <circle cx="7.5" cy={y} r="1.4" />
            </g>
          ))}
        </svg>
      </button>
      <div className="q-body">{children}</div>
    </article>
  );
}

export function QuestionSection({
  kit,
  write,
  onRegenerate,
  busySection,
}: {
  kit: Kit;
  write: Writer;
  onRegenerate: (category: QuestionCategory) => void;
  busySection: string | null;
}) {
  const [category, setCategory] = useState<QuestionCategory>("technical");
  const [editing, setEditing] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<Question | null>(null);
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [formCategory, setFormCategory] = useState<QuestionCategory>("technical");
  const [linked, setLinked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<{ question: Question; cancel: () => void } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const questions = kit.questions.filter((question) => question.category === category);
  function start(question?: Question) {
    setEditing(question ?? null);
    setPrompt(question?.prompt ?? "");
    setOutline(question?.answer_outline ?? "");
    setDifficulty(question?.difficulty ?? 2);
    setFormCategory(question?.category ?? category);
    setLinked(
      question?.requirement_ids ?? (kit.role.requirements[0] ? [kit.role.requirements[0].id] : []),
    );
    setError("");
    setOpen(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!linked.length) {
      setError("Link at least one requirement.");
      return;
    }
    try {
      await write(editing ? `/questions/${editing.id}` : "/questions", editing ? "PATCH" : "POST", {
        prompt,
        answer_outline: outline,
        difficulty,
        category: formCategory,
        requirement_ids: linked,
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save question.");
    }
  }
  function order(ids: string[]) {
    void write("/questions/order", "PUT", { category, ordered_ids: ids }, (current) => {
      if (!current.kit) return current;
      const byId = new Map(current.kit.questions.map((item) => [item.id, item]));
      let index = 0;
      const reordered = current.kit.questions.map((item) =>
        item.category === category ? (byId.get(ids[index++] ?? item.id) ?? item) : item,
      );
      return { ...current, kit: { ...current.kit, questions: reordered } };
    }).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not reorder questions."),
    );
  }
  function move(index: number, direction: -1 | 1) {
    const ids = questions.map((item) => item.id);
    const [id] = ids.splice(index, 1);
    if (id) ids.splice(index + direction, 0, id);
    order(ids);
  }
  function dragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = questions.findIndex((item) => item.id === event.active.id);
    const to = questions.findIndex((item) => item.id === event.over?.id);
    if (from < 0 || to < 0) return;
    const ids = questions.map((item) => item.id);
    const [id] = ids.splice(from, 1);
    if (id) ids.splice(to, 0, id);
    order(ids);
  }
  function remove(question: Question) {
    const timer = window.setTimeout(() => {
      void write(`/questions/${question.id}`, "DELETE").catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not delete question."),
      );
      setUndo(null);
    }, 5000);
    setUndo({
      question,
      cancel: () => {
        window.clearTimeout(timer);
        setUndo(null);
      },
    });
  }
  return (
    <div className="section-stack">
      <div className="section-head">
        <div>
          <h2>Questions</h2>
          <p className="muted">
            Edit the draft, move it between categories, or see the evidence behind it.
          </p>
        </div>
        <Button onClick={() => start()} disabled={!kit.role.requirements.length}>
          Add question
        </Button>
      </div>
      <div className="tabs" role="tablist" aria-label="Question categories">
        {categories.map((item) => (
          <button
            className="tab"
            role="tab"
            aria-selected={category === item}
            key={item}
            onClick={() => setCategory(item)}
          >
            {label(item)}{" "}
            <span className="item-meta">
              ({kit.questions.filter((question) => question.category === item).length})
            </span>
          </button>
        ))}
      </div>
      <div className="section-head">
        <p className="muted">Drag or use the arrow buttons to reorder.</p>
        <Button
          variant="secondary"
          disabled={busySection === `questions:${category}`}
          onClick={() => onRegenerate(category)}
        >
          Regenerate {label(category)}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {undo && (
        <Notice>
          Question removed.{" "}
          <Button variant="quiet" onClick={undo.cancel}>
            Undo
          </Button>
        </Notice>
      )}
      {questions.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
          <SortableContext
            items={questions.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="q-list">
              {questions
                .filter((item) => item.id !== undo?.question.id)
                .map((question, index) => (
                  <SortableQuestion key={question.id} question={question}>
                    <div className="q-meta">
                      <span className="q-id">{question.id.toUpperCase()}</span>
                      <span
                        className="level"
                        data-level={question.difficulty}
                        title={`Difficulty ${question.difficulty} of 3`}
                      >
                        <i />
                        <i />
                        <i />
                        {difficultyLabel(question.difficulty)}
                      </span>
                      {question.requirement_ids.map((id) => (
                        <span key={id} className="tag">
                          {id}
                        </span>
                      ))}
                      {question.pinned && <span className="tag tag-pin">Pinned</span>}
                      {question.edited && <span className="tag">Edited</span>}
                      {question.generated_by === "fallback" && (
                        <span className="tag tag-fallback">Coverage fallback</span>
                      )}
                    </div>
                    <InlineText
                      as="h3"
                      className="q-prompt"
                      label="Question"
                      value={question.prompt}
                      required
                      save={(prompt) => write(`/questions/${question.id}`, "PATCH", { prompt })}
                    />
                    <InlineText
                      className="q-outline"
                      label="Answer outline"
                      value={question.answer_outline}
                      placeholder="Add an answer outline"
                      maxLength={10000}
                      save={(answer_outline) =>
                        write(`/questions/${question.id}`, "PATCH", { answer_outline })
                      }
                    />
                    <div className="q-actions">
                      <ReorderButtons
                        item="question"
                        up={index > 0 ? () => move(index, -1) : undefined}
                        down={index < questions.length - 1 ? () => move(index, 1) : undefined}
                      />
                      <Button variant="quiet" onClick={() => setWhy(question)}>
                        Why this question?
                      </Button>
                      <Button variant="quiet" onClick={() => start(question)}>
                        Edit details
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          void write(`/questions/${question.id}`, "PATCH", {
                            pinned: !question.pinned,
                          })
                        }
                      >
                        {question.pinned ? "Unpin" : "Pin"}
                      </Button>
                      <Button variant="quiet" onClick={() => remove(question)}>
                        Delete
                      </Button>
                    </div>
                  </SortableQuestion>
                ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <EmptyState title="No questions in this category">
          Add a question or regenerate this category.
        </EmptyState>
      )}
      {why && (
        <Dialog title="Why this question?" onClose={() => setWhy(null)}>
          <p>This question is linked to these job-description requirements:</p>
          {why.requirement_ids.map((id) => {
            const requirement = kit.role.requirements.find((item) => item.id === id);
            return requirement ? (
              <div className="card" key={id}>
                <strong>{requirement.text}</strong>
                <p className="item-meta">JD evidence: {requirement.evidence ?? "Added by you"}</p>
              </div>
            ) : null;
          })}
          <h3>Interview context</h3>
          {kit.hiring_process ? (
            <>
              <p>{kit.hiring_process.notes || kit.hiring_process.stages.join(", ")}</p>
              {kit.hiring_process.sources.map((url) => (
                <p key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </p>
              ))}
            </>
          ) : (
            <p className="muted">No interview-process source was found.</p>
          )}
        </Dialog>
      )}
      {open && (
        <Dialog title={editing ? "Edit question" : "Add question"} onClose={() => setOpen(false)}>
          <form onSubmit={(event) => void save(event)}>
            <div className="field">
              <label htmlFor="question-prompt">Question</label>
              <textarea
                id="question-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
                maxLength={5000}
              />
            </div>
            <div className="field">
              <label htmlFor="question-outline">Answer outline</label>
              <textarea
                id="question-outline"
                value={outline}
                onChange={(event) => setOutline(event.target.value)}
                maxLength={10000}
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="question-category">Category</label>
                <select
                  id="question-category"
                  value={formCategory}
                  onChange={(event) => setFormCategory(event.target.value as QuestionCategory)}
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="question-difficulty">Difficulty</label>
                <select
                  id="question-difficulty"
                  value={difficulty}
                  onChange={(event) => setDifficulty(Number(event.target.value))}
                >
                  <option value={1}>1 · Introductory</option>
                  <option value={2}>2 · Applied</option>
                  <option value={3}>3 · Deep</option>
                </select>
              </div>
            </div>
            <fieldset className="field">
              <legend>Linked requirements</legend>
              {kit.role.requirements.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={linked.includes(item.id)}
                    onChange={(event) =>
                      setLinked((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />{" "}
                  {item.id}: {item.text}
                </label>
              ))}
            </fieldset>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit">Save question</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function difficultyLabel(level: number): string {
  return level >= 3 ? "Deep" : level === 2 ? "Applied" : "Introductory";
}
