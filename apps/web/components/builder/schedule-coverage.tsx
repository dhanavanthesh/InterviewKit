"use client";

import type { Kit } from "@interview-kit/schema";
import { EditableText } from "../editable";
import { Button, EmptyState, Loading, Notice } from "../ui";
import type { Coverage } from "../../lib/api";
import type { Writer } from "./kit-builder";

export function ScheduleCoverage({
  kit,
  coverage,
  write,
  onRegenerate,
  busy,
  mode,
}: {
  kit: Kit;
  coverage: Coverage | undefined;
  write: Writer;
  onRegenerate: () => void;
  busy: boolean;
  mode: "schedule" | "coverage";
}) {
  if (mode === "coverage") {
    if (!coverage) return <Loading label="Checking coverage…" />;
    const requirements = kit.role.requirements;
    const must = requirements.filter((item) => item.priority === "must");
    const nice = requirements.filter((item) => item.priority === "nice");
    return (
      <div className="section-stack">
        <section className="surface">
          <h2>Requirement coverage</h2>
          <p>
            Questions cover {requirements.length - coverage.uncovered_requirement_ids.length} of{" "}
            {requirements.length} requirements.
          </p>
          <div className="stat-line">
            <span>
              Must have: {must.length - coverage.must_uncovered_requirement_ids.length} /{" "}
              {must.length}
            </span>
            <span>
              Nice to have: {nice.length - coverage.nice_uncovered_requirement_ids.length} /{" "}
              {nice.length}
            </span>
            <span>Coverage passes: {coverage.passes}</span>
          </div>
          {coverage.must_uncovered_requirement_ids.length > 0 && (
            <Notice tone="error">
              Some must-have requirements have no question. This can happen after edits. Add or link
              a question to close the gap.
            </Notice>
          )}
        </section>
        <section className="surface">
          <h2>Uncovered requirements</h2>
          {coverage.uncovered_requirement_ids.length ? (
            <div className="simple-list">
              {coverage.uncovered_requirement_ids.map((id) => {
                const item = requirements.find((candidate) => candidate.id === id);
                return item ? (
                  <article key={id} className="card">
                    <span className={`chip ${item.priority === "must" ? "chip-must" : ""}`}>
                      {item.priority}
                    </span>
                    <strong>{item.text}</strong>
                    <p className="item-meta">{item.evidence ?? "Added by you"}</p>
                  </article>
                ) : null;
              })}
            </div>
          ) : (
            <EmptyState title="Everything is linked">
              Every listed requirement has a question.
            </EmptyState>
          )}
        </section>
        {coverage.history.length > 0 && (
          <section className="surface">
            <h2>Coverage passes</h2>
            <ol>
              {coverage.history.map((pass) => (
                <li key={pass.pass}>
                  Pass {pass.pass}: {pass.uncovered_ids.length} uncovered
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    );
  }
  return (
    <div className="section-stack">
      <div className="section-head">
        <div>
          <h2>{kit.schedule.days_available}-day schedule</h2>
          <p className="muted">
            Higher-priority, harder questions appear earlier. Review days keep the count exact.
          </p>
        </div>
        <Button variant="secondary" onClick={onRegenerate} disabled={busy}>
          Regenerate schedule
        </Button>
      </div>
      <div className="day-list">
        {kit.schedule.days.map((day) => (
          <article className="day-row" key={day.day}>
            <h3>Day {day.day}</h3>
            <div>
              <EditableText
                label={`Day ${day.day} focus`}
                value={day.focus}
                maxLength={1000}
                save={(focus) => write(`/schedule/days/${day.day}`, "PATCH", { focus })}
              />
              <ul>
                {day.question_ids.map((id) => {
                  const question = kit.questions.find((item) => item.id === id);
                  return question ? <li key={id}>{question.prompt}</li> : null;
                })}
              </ul>
              {!day.question_ids.length && (
                <p className="muted">Review the company brief and job description.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor={`minutes-${day.day}`}>Minutes</label>
              <input
                id={`minutes-${day.day}`}
                className="field-input"
                type="number"
                min={1}
                max={1440}
                step={1}
                defaultValue={day.minutes}
                onBlur={(event) => {
                  const minutes = Number(event.target.value);
                  if (
                    Number.isInteger(minutes) &&
                    minutes >= 1 &&
                    minutes <= 1440 &&
                    minutes !== day.minutes
                  )
                    void write(`/schedule/days/${day.day}`, "PATCH", { minutes });
                }}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
