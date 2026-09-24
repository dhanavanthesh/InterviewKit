"use client";

import type { Flashcard, Kit } from "@interview-kit/schema";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { InlineText, ReorderButtons } from "../editable";
import { Button, Dialog, EmptyState, Notice } from "../ui";
import type { Writer } from "./kit-builder";

export function FlashcardSection({ kit, write }: { kit: Kit; write: Writer }) {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState<Flashcard | null>(null);
  const [open, setOpen] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [linked, setLinked] = useState<string[]>([]);
  const [questionId, setQuestionId] = useState("");
  const [error, setError] = useState("");
  function start(card?: Flashcard) {
    setEditing(card ?? null);
    setFront(card?.front ?? "");
    setBack(card?.back ?? "");
    setLinked(
      card?.requirement_ids ?? (kit.role.requirements[0] ? [kit.role.requirements[0].id] : []),
    );
    setQuestionId(card?.question_id ?? "");
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
      await write(
        editing ? `/flashcards/${editing.id}` : "/flashcards",
        editing ? "PATCH" : "POST",
        {
          front,
          back,
          requirement_ids: linked,
          ...(editing
            ? { question_id: questionId || null }
            : questionId
              ? { question_id: questionId }
              : {}),
        },
      );
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save flashcard.");
    }
  }
  function reorder(index: number, direction: -1 | 1) {
    const ids = kit.flashcards.map((item) => item.id);
    const [cardId] = ids.splice(index, 1);
    if (cardId) ids.splice(index + direction, 0, cardId);
    void write("/flashcards/order", "PUT", { ordered_ids: ids }, (current) => {
      if (!current.kit) return current;
      const byId = new Map(current.kit.flashcards.map((item) => [item.id, item]));
      return { ...current, kit: { ...current.kit, flashcards: ids.map((id) => byId.get(id)!) } };
    }).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not reorder flashcards."),
    );
  }
  return (
    <div className="section-stack">
      <div className="section-head">
        <div>
          <h2>Flashcards</h2>
          <p className="muted">Short prompts for active recall.</p>
        </div>
        <div className="actions">
          {kit.flashcards.length > 0 && (
            <Link className="button button-secondary" href={`/kits/${id}/practice`}>
              Practice
            </Link>
          )}
          <Button onClick={() => start()} disabled={!kit.role.requirements.length}>
            Add card
          </Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {kit.flashcards.length ? (
        <div className="flash-list">
          {kit.flashcards.map((card, index) => (
            <article className="flash-row" key={card.id}>
              <div className="item-head">
                <span className="item-meta">
                  {index + 1}. {card.id}
                </span>
                <span className="item-meta">
                  {card.requirement_ids.join(", ")}
                  {card.pinned ? " · Pinned" : ""}
                </span>
              </div>
              <div className="flash-front">
                <InlineText
                  as="h3"
                  label="Flashcard front"
                  value={card.front}
                  required
                  save={(front) => write(`/flashcards/${card.id}`, "PATCH", { front })}
                />
              </div>
              <div className="flash-back">
                <InlineText
                  className="item-copy"
                  label="Flashcard back"
                  value={card.back}
                  placeholder="Add an answer"
                  maxLength={10000}
                  save={(back) => write(`/flashcards/${card.id}`, "PATCH", { back })}
                />
              </div>
              <div className="actions">
                <ReorderButtons
                  item="flashcard"
                  up={index > 0 ? () => reorder(index, -1) : undefined}
                  down={index < kit.flashcards.length - 1 ? () => reorder(index, 1) : undefined}
                />
                <Button variant="quiet" onClick={() => start(card)}>
                  Edit details
                </Button>
                <Button
                  variant="quiet"
                  onClick={() =>
                    void write(`/flashcards/${card.id}`, "PATCH", { pinned: !card.pinned })
                  }
                >
                  {card.pinned ? "Unpin" : "Pin"}
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => void write(`/flashcards/${card.id}`, "DELETE")}
                >
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No flashcards yet">Create a card to start practicing.</EmptyState>
      )}
      {open && (
        <Dialog title={editing ? "Edit flashcard" : "Add flashcard"} onClose={() => setOpen(false)}>
          <form onSubmit={(event) => void save(event)}>
            <div className="field">
              <label htmlFor="card-front">Front</label>
              <textarea
                id="card-front"
                value={front}
                onChange={(event) => setFront(event.target.value)}
                required
                maxLength={5000}
              />
            </div>
            <div className="field">
              <label htmlFor="card-back">Back</label>
              <textarea
                id="card-back"
                value={back}
                onChange={(event) => setBack(event.target.value)}
                maxLength={10000}
              />
            </div>
            <div className="field">
              <label htmlFor="card-question">Source question</label>
              <select
                id="card-question"
                value={questionId}
                onChange={(event) => setQuestionId(event.target.value)}
              >
                <option value="">None</option>
                {kit.questions.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.prompt}
                  </option>
                ))}
              </select>
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
                          : current.filter((rid) => rid !== item.id),
                      )
                    }
                  />{" "}
                  {item.id}: {item.text}
                </label>
              ))}
            </fieldset>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit">Save flashcard</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
