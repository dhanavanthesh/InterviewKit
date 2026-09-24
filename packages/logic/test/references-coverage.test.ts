import { describe, expect, it } from "vitest";

import { checkKitReferences, findGaps } from "../src/index";
import { makeKit, questions, requirements } from "./test-data";

describe("reference validation", () => {
  it("returns no issues for a fully valid kit", () => {
    expect(checkKitReferences(makeKit())).toEqual([]);
  });

  it("finds a flashcard linked to a removed question", () => {
    const kit = makeKit();
    kit.flashcards[0]!.question_id = "missing";
    expect(checkKitReferences(kit).map((issue) => issue.code)).toContain(
      "UNKNOWN_FLASHCARD_QUESTION",
    );
  });

  it.each([
    ["question", "UNKNOWN_QUESTION_REQUIREMENT"],
    ["flashcard", "UNKNOWN_FLASHCARD_REQUIREMENT"],
    ["schedule", "UNKNOWN_SCHEDULE_QUESTION"],
  ] as const)("finds a dangling %s reference", (kind, code) => {
    const kit = makeKit();
    if (kind === "question") kit.questions[0]!.requirement_ids = ["missing"];
    if (kind === "flashcard") kit.flashcards[0]!.requirement_ids = ["missing"];
    if (kind === "schedule") kit.schedule.days[0]!.question_ids = ["missing"];
    expect(checkKitReferences(kit).map((issue) => issue.code)).toContain(code);
  });

  it.each([
    ["requirement", "DUPLICATE_REQUIREMENT_ID"],
    ["question", "DUPLICATE_QUESTION_ID"],
    ["flashcard", "DUPLICATE_FLASHCARD_ID"],
  ] as const)("finds a duplicate %s id", (kind, code) => {
    const kit = makeKit();
    if (kind === "requirement") kit.role.requirements[1]!.id = "r1";
    if (kind === "question") kit.questions[1]!.id = "q1";
    if (kind === "flashcard") kit.flashcards[1]!.id = "f1";
    expect(checkKitReferences(kit).map((issue) => issue.code)).toContain(code);
  });

  it("finds a day-count mismatch", () => {
    const kit = makeKit();
    kit.schedule.days_available = 4;
    expect(checkKitReferences(kit).map((issue) => issue.code)).toContain("SCHEDULE_DAY_COUNT");
  });

  it("finds nonsequential and duplicate day numbers", () => {
    const kit = makeKit();
    kit.schedule.days[1]!.day = 1;
    expect(checkKitReferences(kit).map((issue) => issue.code)).toContain(
      "NONSEQUENTIAL_SCHEDULE_DAY",
    );
  });
});

describe("coverage gaps", () => {
  it("returns no gaps when every requirement is covered", () => {
    expect(findGaps(requirements, questions).all).toEqual([]);
  });

  it("separates must and nice gaps", () => {
    expect(findGaps(requirements, [questions[0]!])).toEqual({
      all: ["r2", "r3"],
      must: ["r2"],
      nice: ["r3"],
    });
  });

  it("does not count unknown IDs as coverage", () => {
    const unknown = { ...questions[0]!, requirement_ids: ["unknown"] };
    expect(findGaps(requirements, [unknown]).all).toEqual(["r1", "r2", "r3"]);
  });

  it("ignores duplicate references", () => {
    const duplicate = { ...questions[0]!, requirement_ids: ["r1", "r1"] };
    expect(findGaps(requirements, [duplicate]).all).toEqual(["r2", "r3"]);
  });

  it("keeps stable requirement order", () => {
    expect(findGaps(requirements, []).all).toEqual(["r1", "r2", "r3"]);
  });

  it("returns no gaps for empty requirements", () => {
    expect(findGaps([], questions)).toEqual({ all: [], must: [], nice: [] });
  });
});
