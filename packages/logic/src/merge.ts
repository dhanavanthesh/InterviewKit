import type { Question, QuestionCategory } from "@interview-kit/schema";

import { mustSurviveRegeneration, normalizePrompt } from "./item-state";

export interface MergeCategoryInput {
  existingQuestions: readonly Question[];
  category: QuestionCategory;
  generatedQuestions: readonly Question[];
  tombstones: Readonly<Record<string, readonly string[]>>;
  nextQuestionNumber: number;
}

export interface MergeCategoryResult {
  questions: Question[];
  nextQuestionNumber: number;
}

function allocateQuestionId(usedIds: Set<string>, start: number): { id: string; next: number } {
  let counter = Math.max(1, start);
  while (usedIds.has(`q${counter}`)) counter += 1;
  return { id: `q${counter}`, next: counter + 1 };
}

export function mergeQuestionCategory(input: MergeCategoryInput): MergeCategoryResult {
  const outsideCategory = input.existingQuestions.filter(
    ({ category }) => category !== input.category,
  );
  const retained = input.existingQuestions.filter(
    (question) => question.category === input.category && mustSurviveRegeneration(question),
  );
  const blockedPrompts = new Set([
    ...(input.tombstones[input.category] ?? []),
    ...retained.map(({ prompt }) => normalizePrompt(prompt)),
  ]);
  const usedIds = new Set(input.existingQuestions.map(({ id }) => id));
  const additions: Question[] = [];
  let nextQuestionNumber = input.nextQuestionNumber;

  for (const generated of input.generatedQuestions) {
    const normalized = normalizePrompt(generated.prompt);
    if (blockedPrompts.has(normalized)) continue;
    blockedPrompts.add(normalized);
    const allocated = allocateQuestionId(usedIds, nextQuestionNumber);
    usedIds.add(allocated.id);
    nextQuestionNumber = allocated.next;
    additions.push({
      ...generated,
      id: allocated.id,
      category: input.category,
      origin: "generated",
      edited: false,
      pinned: false,
      generated_by: generated.generated_by ?? "draft",
    });
  }

  return {
    questions: [...outsideCategory, ...retained, ...additions],
    nextQuestionNumber,
  };
}

export interface EditableBrief {
  summary: string;
  what_they_do: string;
  sources: string[];
  summary_edited?: boolean;
  what_they_do_edited?: boolean;
}

export function mergeCompanyBrief(
  existing: EditableBrief,
  regenerated: EditableBrief,
): EditableBrief {
  return {
    summary: existing.summary_edited === true ? existing.summary : regenerated.summary,
    what_they_do:
      existing.what_they_do_edited === true ? existing.what_they_do : regenerated.what_they_do,
    sources: regenerated.sources,
    summary_edited: existing.summary_edited ?? false,
    what_they_do_edited: existing.what_they_do_edited ?? false,
  };
}
