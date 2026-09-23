import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { allocateSchedule } from "../src/index";
import { flashcards, questions, requirements } from "./test-data";

describe("schedule examples", () => {
  it.each([1, 5, 60])("creates exactly %s sequential days", (daysAvailable) => {
    const schedule = allocateSchedule({ requirements, questions, flashcards, daysAvailable });
    expect(schedule.days).toHaveLength(daysAvailable);
    expect(schedule.days.map(({ day }) => day)).toEqual(
      Array.from({ length: daysAvailable }, (_, index) => index + 1),
    );
  });

  it.each([2, 3, 5])("schedules every question when day count is %s", (daysAvailable) => {
    const schedule = allocateSchedule({ requirements, questions, flashcards, daysAvailable });
    const scheduled = new Set(schedule.days.flatMap(({ question_ids }) => question_ids));
    expect(scheduled).toEqual(new Set(questions.map(({ id }) => id)));
  });

  it("creates honest days when there are no questions", () => {
    const schedule = allocateSchedule({
      requirements: [],
      questions: [],
      flashcards: [],
      daysAvailable: 5,
    });
    expect(schedule.days).toHaveLength(5);
    expect(
      schedule.days.every(
        ({ question_ids, minutes }) => question_ids.length === 0 && minutes === 30,
      ),
    ).toBe(true);
  });

  it("puts must-linked and harder questions first", () => {
    const schedule = allocateSchedule({
      requirements,
      questions: [...questions].reverse(),
      flashcards: [],
      daysAvailable: 3,
    });
    expect(schedule.days.map(({ question_ids }) => question_ids[0])).toEqual(["q1", "q2", "q3"]);
  });

  it("works when no question is must-linked", () => {
    const nice = requirements.map((requirement) => ({ ...requirement, priority: "nice" as const }));
    expect(
      allocateSchedule({ requirements: nice, questions, flashcards: [], daysAvailable: 5 }).days,
    ).toHaveLength(5);
  });

  it("returns deterministic schedules with integer minutes and no dangling ids", () => {
    const input = { requirements, questions, flashcards, daysAvailable: 5 };
    const first = allocateSchedule(input);
    expect(allocateSchedule(input)).toEqual(first);
    const known = new Set(questions.map(({ id }) => id));
    expect(first.days.every(({ minutes }) => Number.isInteger(minutes))).toBe(true);
    expect(
      first.days.flatMap(({ question_ids }) => question_ids).every((id) => known.has(id)),
    ).toBe(true);
  });

  it("rejects invalid day counts", () => {
    expect(() =>
      allocateSchedule({ requirements, questions, flashcards, daysAvailable: 0 }),
    ).toThrow(RangeError);
  });
});

describe("schedule properties", () => {
  it("preserves all scheduling invariants", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 35 }),
        fc.integer({ min: 1, max: 120 }),
        (requirementCount, questionCount, daysAvailable) => {
          const generatedRequirements = Array.from({ length: requirementCount }, (_, index) => ({
            id: `r${index + 1}`,
            text: `Requirement ${index + 1}`,
            kind: index % 3 === 0 ? ("technical" as const) : ("behavioural" as const),
            priority: index % 2 === 0 ? ("must" as const) : ("nice" as const),
          }));
          const generatedQuestions = Array.from({ length: questionCount }, (_, index) => ({
            id: `q${index + 1}`,
            requirement_ids: requirementCount === 0 ? [] : [`r${(index % requirementCount) + 1}`],
            category: index % 2 === 0 ? ("technical" as const) : ("behavioural" as const),
            prompt: `Question ${index + 1}`,
            answer_outline: "Outline",
            difficulty: ((index % 3) + 1) as 1 | 2 | 3,
          }));
          const input = {
            requirements: generatedRequirements,
            questions: generatedQuestions,
            flashcards: [],
            daysAvailable,
          };
          const schedule = allocateSchedule(input);
          const known = new Set(generatedQuestions.map(({ id }) => id));
          const scheduled = new Set(schedule.days.flatMap(({ question_ids }) => question_ids));

          expect(schedule.days_available).toBe(daysAvailable);
          expect(schedule.days).toHaveLength(daysAvailable);
          expect(schedule.days.map(({ day }) => day)).toEqual(
            Array.from({ length: daysAvailable }, (_, index) => index + 1),
          );
          expect(schedule.days.every(({ minutes }) => Number.isInteger(minutes))).toBe(true);
          expect([...scheduled].every((id) => known.has(id))).toBe(true);
          expect([...known].every((id) => scheduled.has(id))).toBe(true);
          expect(allocateSchedule(input)).toEqual(schedule);
        },
      ),
      { numRuns: 150 },
    );
  });
});
