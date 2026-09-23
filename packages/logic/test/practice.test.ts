import { describe, expect, it } from "vitest";

import { getPracticeProgress, getRequirementReadiness, orderPracticeSession } from "../src/index";
import { flashcards, requirements } from "./test-data";

describe("practice ordering", () => {
  it("places unseen and confidence-one cards first", () => {
    const order = orderPracticeSession(flashcards, [
      { cardId: "f2", confidence: 1, reviewedAt: "2026-09-22T10:00:00Z" },
      { cardId: "f3", confidence: 4, reviewedAt: "2026-09-20T10:00:00Z" },
    ]);
    expect(order.slice(0, 2)).toEqual(["f1", "f2"]);
  });

  it("orders confidence buckets from 1 through 4", () => {
    const cards = [...flashcards, { ...flashcards[0]!, id: "f4" }];
    const reviews = [4, 3, 2, 1].map((confidence, index) => ({
      cardId: cards[index]!.id,
      confidence: confidence as 1 | 2 | 3 | 4,
      reviewedAt: "2026-09-23T10:00:00Z",
    }));
    expect(orderPracticeSession(cards, reviews)).toEqual(["f4", "f3", "f2", "f1"]);
  });

  it("uses oldest review then stable card order as tie breakers", () => {
    const reviews = [
      { cardId: "f1", confidence: 2 as const, reviewedAt: "2026-09-23T10:00:00Z" },
      { cardId: "f2", confidence: 2 as const, reviewedAt: "2026-09-20T10:00:00Z" },
      { cardId: "f3", confidence: 2 as const, reviewedAt: "2026-09-20T10:00:00Z" },
    ];
    expect(orderPracticeSession(flashcards, reviews)).toEqual(["f2", "f3", "f1"]);
  });
});

describe("practice progress", () => {
  it("reports covered and uncovered cards", () => {
    const progress = getPracticeProgress(flashcards, [
      { cardId: "f2", confidence: 2, reviewedAt: "2026-09-20T10:00:00Z" },
    ]);
    expect(progress.coveredCardIds).toEqual(["f2"]);
    expect(progress.uncoveredCardIds).toEqual(["f1", "f3"]);
    expect(progress.coveredRatio).toBeCloseTo(1 / 3);
  });

  it("handles empty cards without division errors", () => {
    expect(getPracticeProgress([], [])).toMatchObject({ totalCount: 0, coveredRatio: 0 });
  });

  it("marks a requirement ready only when all associated cards are at least confidence 3", () => {
    const cards = [flashcards[0]!, { ...flashcards[0]!, id: "f4" }];
    const readiness = getRequirementReadiness(requirements, cards, [
      { cardId: "f1", confidence: 4, reviewedAt: "2026-09-20T10:00:00Z" },
      { cardId: "f4", confidence: 3, reviewedAt: "2026-09-20T10:00:00Z" },
    ]);
    expect(readiness).toEqual({ r1: true, r2: false, r3: false });
  });
});
