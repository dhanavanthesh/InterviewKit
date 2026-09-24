"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, json, type PracticeProgress, type PracticeSession } from "../../../../lib/api";
import { BackLink, Button, EmptyState, Loading, Notice } from "../../../../components/ui";

const confidence = ["Not yet", "Shaky", "Comfortable", "Ready"];

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api<PracticeSession>(`/kits/${id}/practice/session`),
  });
  const progress = useQuery({
    queryKey: ["practice-progress", id],
    queryFn: () => api<PracticeProgress>(`/kits/${id}/practice/progress`),
  });
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = session.data?.cards[index];
  const submit = useCallback(
    async (value: number) => {
      if (!card || !revealed || busy) return;
      setBusy(true);
      setError("");
      try {
        await api(
          `/kits/${id}/practice/reviews`,
          json("POST", { card_id: card.id, confidence: value }),
        );
        setIndex((current) => current + 1);
        setRevealed(false);
        await client.invalidateQueries({ queryKey: ["practice-progress", id] });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save your review.");
      } finally {
        setBusy(false);
      }
    },
    [busy, card, client, id, revealed],
  );
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (event.key === "Escape") {
        router.push(`/kits/${id}`);
        return;
      }
      if (event.key === "ArrowLeft" && index > 0 && !busy) {
        setIndex(index - 1);
        setRevealed(false);
        return;
      }
      if (event.key === "ArrowRight" && index < (session.data?.cards.length ?? 0) - 1 && !busy) {
        setIndex(index + 1);
        setRevealed(false);
        return;
      }
      if ((event.key === " " || event.key === "Enter") && !revealed && card) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void submit(Number(event.key));
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, card, id, index, revealed, router, session.data?.cards.length, submit]);
  if (session.isPending || progress.isPending)
    return <Loading label="Preparing your practice session…" />;
  if (session.isError || progress.isError)
    return (
      <Notice tone="error">
        Practice could not load.{" "}
        <Button
          variant="quiet"
          onClick={() => {
            void session.refetch();
            void progress.refetch();
          }}
        >
          Try again
        </Button>
      </Notice>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <BackLink href={`/kits/${id}`}>Back to kit</BackLink>
          <h1>Practice</h1>
          <p>
            Unseen and lower-confidence cards come first. Reveal an answer, then rate how ready you
            feel.
          </p>
        </div>
      </div>
      {session.data.cards.length > 0 && (
        <div className="practice-top">
          <div className="practice-counts">
            <span>
              Card <strong>{Math.min(index + 1, session.data.cards.length)}</strong> of{" "}
              {session.data.cards.length}
            </span>
            <span>
              Covered <strong>{progress.data.coveredCardIds.length}</strong> · Remaining{" "}
              <strong>{progress.data.uncoveredCardIds.length}</strong>
            </span>
          </div>
          <div
            className="meter"
            role="progressbar"
            aria-label="Session progress"
            aria-valuemin={0}
            aria-valuemax={session.data.cards.length}
            aria-valuenow={Math.min(index, session.data.cards.length)}
          >
            <span
              style={{
                width: `${(Math.min(index, session.data.cards.length) / session.data.cards.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!session.data.cards.length ? (
        <EmptyState title="No flashcards yet">
          <p>Add a card in the kit builder, then return to practice.</p>
          <Link href={`/kits/${id}?tab=flashcards`} className="button button-primary">
            Add flashcards
          </Link>
        </EmptyState>
      ) : !card ? (
        <EmptyState title="Session complete">
          <p>
            You reviewed every card in this session. Come back later to reinforce weaker answers.
          </p>
          <Button
            onClick={() => {
              setIndex(0);
              void session.refetch();
            }}
          >
            Start another session
          </Button>
        </EmptyState>
      ) : (
        <>
          <article className="card practice-card" aria-live="polite">
            <div className="practice-face">
              <span className="flash-label" data-mark="Q">
                Question {index + 1}
              </span>
              <h2>{card.front}</h2>
            </div>
            {revealed && (
              <div className="answer">
                <span className="flash-label" data-mark="A">
                  Answer
                </span>
                <p>{card.back || "No answer has been added yet."}</p>
              </div>
            )}
          </article>
          <nav className="practice-navigation" aria-label="Flashcard navigation">
            <Button
              variant="secondary"
              className="icon-button"
              aria-label="Previous card"
              title="Previous card"
              disabled={index === 0 || busy}
              onClick={() => {
                setIndex(index - 1);
                setRevealed(false);
              }}
            >
              ←
            </Button>
            <span>
              {index + 1} / {session.data.cards.length}
            </span>
            <Button
              variant="secondary"
              className="icon-button"
              aria-label="Next card"
              title="Next card"
              disabled={index >= session.data.cards.length - 1 || busy}
              onClick={() => {
                setIndex(index + 1);
                setRevealed(false);
              }}
            >
              →
            </Button>
          </nav>
          {!revealed ? (
            <div className="practice-controls">
              <Button onClick={() => setRevealed(true)}>
                Reveal answer <span className="kbd">Space</span>
              </Button>
            </div>
          ) : (
            <div className="rating-grid" role="group" aria-label="How confident do you feel?">
              {confidence.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className={`rating rating-${i + 1}`}
                  disabled={busy}
                  onClick={() => void submit(i + 1)}
                >
                  <span className="kbd">{i + 1}</span>
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="practice-hint">Space to reveal · 1–4 to rate · ← → to move · Esc to exit</p>
        </>
      )}
      <section className="surface" style={{ marginTop: 32 }}>
        <h2>Requirement readiness</h2>
        <p className="muted">
          A requirement is ready when all its associated cards have confidence 3 or 4.
        </p>
        <ul className="readiness">
          {Object.entries(progress.data.requirement_readiness).map(([rid, ready]) => (
            <li key={rid} className={ready ? "is-ready" : undefined}>
              {rid}: {ready ? "Ready" : "Keep practicing"}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
