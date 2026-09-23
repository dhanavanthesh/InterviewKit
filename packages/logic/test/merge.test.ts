import { describe, expect, it } from "vitest";

import {
  markQuestionEdited,
  mergeCompanyBrief,
  mergeQuestionCategory,
  normalizePrompt,
  recordQuestionTombstone,
  toggleQuestionPinned,
} from "../src/index";
import { questions } from "./test-data";

const generatedReplacement = {
  ...questions[0]!,
  id: "temporary",
  prompt: "A newly generated TypeScript question",
};

describe("item state", () => {
  it("marks a question edited and toggles pinned state", () => {
    expect(markQuestionEdited(questions[0]!).edited).toBe(true);
    expect(toggleQuestionPinned(questions[0]!).pinned).toBe(true);
  });

  it("normalizes prompts for conservative deduplication", () => {
    expect(normalizePrompt("  HOW do you test APIs? ")).toBe("how do you test apis");
  });

  it("records generated deletions but not user deletions", () => {
    const generated = { ...questions[0]!, origin: "generated" as const };
    expect(recordQuestionTombstone({}, generated).technical).toEqual([
      normalizePrompt(generated.prompt),
    ]);
    expect(recordQuestionTombstone({}, { ...generated, origin: "user" })).toEqual({});
  });
});

describe("category regeneration merge", () => {
  it("replaces untouched generated questions", () => {
    const result = mergeQuestionCategory({
      existingQuestions: [{ ...questions[0]!, origin: "generated", edited: false, pinned: false }],
      category: "technical",
      generatedQuestions: [generatedReplacement],
      tombstones: {},
      nextQuestionNumber: 2,
    });
    expect(result.questions.map(({ prompt }) => prompt)).toEqual([generatedReplacement.prompt]);
  });

  it.each([
    { origin: "user" as const, edited: false, pinned: false },
    { origin: "generated" as const, edited: true, pinned: false },
    { origin: "generated" as const, edited: false, pinned: true },
  ])("keeps protected questions and their IDs", (state) => {
    const protectedQuestion = { ...questions[0]!, ...state };
    const result = mergeQuestionCategory({
      existingQuestions: [protectedQuestion],
      category: "technical",
      generatedQuestions: [generatedReplacement],
      tombstones: {},
      nextQuestionNumber: 2,
    });
    expect(result.questions[0]!.id).toBe("q1");
    expect(result.questions[0]!.prompt).toBe(protectedQuestion.prompt);
  });

  it("keeps category-moved and other-category questions untouched", () => {
    const moved = { ...questions[0]!, category: "behavioural" as const, edited: true };
    const result = mergeQuestionCategory({
      existingQuestions: [moved, questions[2]!],
      category: "technical",
      generatedQuestions: [generatedReplacement],
      tombstones: {},
      nextQuestionNumber: 1,
    });
    expect(result.questions.slice(0, 2)).toEqual([moved, questions[2]]);
  });

  it("allocates collision-free IDs", () => {
    const result = mergeQuestionCategory({
      existingQuestions: [questions[0]!, questions[1]!],
      category: "technical",
      generatedQuestions: [generatedReplacement],
      tombstones: {},
      nextQuestionNumber: 1,
    });
    expect(new Set(result.questions.map(({ id }) => id)).size).toBe(result.questions.length);
  });

  it("blocks tombstoned and normalized duplicate prompts", () => {
    const prompt = generatedReplacement.prompt;
    const duplicate = { ...generatedReplacement, prompt: `  ${prompt.toUpperCase()}! ` };
    const result = mergeQuestionCategory({
      existingQuestions: [],
      category: "technical",
      generatedQuestions: [generatedReplacement, duplicate],
      tombstones: { technical: [normalizePrompt(prompt)] },
      nextQuestionNumber: 1,
    });
    expect(result.questions).toEqual([]);
  });

  it("preserves retained relative order", () => {
    const retained = [
      { ...questions[0]!, id: "q8", edited: true },
      { ...questions[0]!, id: "q2", prompt: "Second", pinned: true },
    ];
    const result = mergeQuestionCategory({
      existingQuestions: retained,
      category: "technical",
      generatedQuestions: [generatedReplacement],
      tombstones: {},
      nextQuestionNumber: 1,
    });
    expect(result.questions.slice(0, 2).map(({ id }) => id)).toEqual(["q8", "q2"]);
  });
});

describe("company brief merge", () => {
  it("preserves edited fields and replaces untouched fields", () => {
    const merged = mergeCompanyBrief(
      {
        summary: "My summary",
        what_they_do: "Old detail",
        sources: ["old"],
        summary_edited: true,
        what_they_do_edited: false,
      },
      { summary: "New summary", what_they_do: "New detail", sources: ["new"] },
    );
    expect(merged).toMatchObject({
      summary: "My summary",
      what_they_do: "New detail",
      sources: ["new"],
    });
  });

  it("preserves an edited what-they-do field", () => {
    const merged = mergeCompanyBrief(
      {
        summary: "Old",
        what_they_do: "My detail",
        sources: [],
        what_they_do_edited: true,
      },
      { summary: "New", what_they_do: "Generated", sources: [] },
    );
    expect(merged.what_they_do).toBe("My detail");
    expect(merged.summary).toBe("New");
  });
});
