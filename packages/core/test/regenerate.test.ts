import { allocateSchedule, checkKitReferences, findGaps } from "@interview-kit/logic";
import type { Kit, Question, Requirement } from "@interview-kit/schema";
import { describe, expect, it } from "vitest";

import { systemClock } from "../src/clock";
import { parseConfig } from "../src/config";
import { regenerateSection } from "../src/regenerate";
import { InMemoryPipelineStore } from "../src/store";
import type { PipelineDependencies } from "../src/types";

const requirements: Requirement[] = [
  { id: "r1", text: "TypeScript services", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentor engineers", kind: "behavioural", priority: "nice" },
];

const questions: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Old generated TypeScript services question",
    answer_outline: "TypeScript services",
    difficulty: 2,
    origin: "generated",
    edited: false,
    pinned: false,
    generated_by: "draft",
  },
  {
    id: "q2",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "My TypeScript services question",
    answer_outline: "TypeScript services",
    difficulty: 2,
    origin: "user",
    edited: false,
    pinned: false,
    generated_by: "user",
  },
  {
    id: "q3",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Edited TypeScript services question",
    answer_outline: "TypeScript services",
    difficulty: 2,
    origin: "generated",
    edited: true,
    pinned: false,
    generated_by: "draft",
  },
  {
    id: "q4",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Pinned TypeScript services question",
    answer_outline: "TypeScript services",
    difficulty: 2,
    origin: "generated",
    edited: false,
    pinned: true,
    generated_by: "draft",
  },
  {
    id: "q5",
    requirement_ids: ["r2"],
    category: "behavioural",
    prompt: "Tell me about mentoring engineers",
    answer_outline: "Mentor engineers with STAR",
    difficulty: 2,
    origin: "generated",
    edited: false,
    pinned: false,
    generated_by: "draft",
  },
];

function baseKit(): Kit {
  const schedule = allocateSchedule({ requirements, questions, flashcards: [], daysAvailable: 3 });
  return {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Engineer",
      location: "",
      jd_chars: 100,
      researched_at: "2026-09-24T00:00:00Z",
      pages_used: [],
    },
    company_brief: { summary: "Brief", what_they_do: "Work", sources: [] },
    role: { title: "Engineer", seniority: "", responsibilities: [], requirements },
    questions,
    flashcards: [],
    schedule,
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

function dependencies(): PipelineDependencies {
  return {
    fetcher: { fetch: () => Promise.reject(new Error("unused")) },
    store: new InMemoryPipelineStore(),
    discussion: { search: () => Promise.resolve({ hits: [], failed: false }) },
    clock: systemClock,
    config: parseConfig({}),
  };
}

describe("section regeneration", () => {
  it("replaces untouched generated questions but retains user, edited, and pinned work", async () => {
    const regenerated = await regenerateSection(
      baseKit(),
      { section: "questions", category: "technical" },
      dependencies(),
    );
    expect(regenerated.questions.map(({ id }) => id)).not.toContain("q1");
    expect(regenerated.questions.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["q2", "q3", "q4", "q5"]),
    );
    expect(regenerated.questions.find(({ id }) => id === "q5")?.category).toBe("behavioural");
    expect(checkKitReferences(regenerated)).toEqual([]);
    expect(findGaps(requirements, regenerated.questions).must).toEqual([]);
  });

  it("keeps flashcards consistent when their source questions are replaced", async () => {
    const card = (
      id: string,
      questionId: string,
      extra: Partial<Kit["flashcards"][number]> = {},
    ) => ({
      id,
      front: `Front ${id}`,
      back: `Back ${id}`,
      requirement_ids: ["r1"],
      question_id: questionId,
      origin: "generated" as const,
      edited: false,
      pinned: false,
      generated_by: "draft" as const,
      ...extra,
    });
    const kit: Kit = {
      ...baseKit(),
      flashcards: [
        card("f1", "q1"),
        card("f2", "q3"),
        card("f3", "q1", { origin: "user", generated_by: "user" }),
        card("f4", "q5"),
      ],
    };
    const regenerated = await regenerateSection(
      kit,
      { section: "questions", category: "technical" },
      dependencies(),
    );
    const questionIds = new Set(regenerated.questions.map(({ id }) => id));
    expect(checkKitReferences(regenerated)).toEqual([]);
    expect(
      regenerated.flashcards.every(
        (item) => item.question_id === undefined || questionIds.has(item.question_id),
      ),
    ).toBe(true);
    expect(regenerated.flashcards.map(({ id }) => id)).not.toContain("f1");
    expect(regenerated.flashcards.find(({ id }) => id === "f2")?.question_id).toBe("q3");
    const userCard = regenerated.flashcards.find(({ id }) => id === "f3");
    expect(userCard?.front).toBe("Front f3");
    expect(userCard?.question_id).toBeUndefined();
    expect(regenerated.flashcards.find(({ id }) => id === "f4")?.question_id).toBe("q5");
    const added = regenerated.questions.filter(({ id }) => !kit.questions.some((q) => q.id === id));
    for (const question of added) {
      expect(regenerated.flashcards.some((item) => item.question_id === question.id)).toBe(true);
    }
    expect(regenerated.flashcards.every(({ back }) => back.trim().length > 0)).toBe(true);
  });

  it("recomputes an exact deterministic schedule without changing questions", async () => {
    const kit = baseKit();
    const regenerated = await regenerateSection(kit, { section: "schedule" }, dependencies());
    expect(regenerated.questions).toEqual(kit.questions);
    expect(regenerated.schedule.days).toHaveLength(3);
    expect(checkKitReferences(regenerated)).toEqual([]);
  });
});
