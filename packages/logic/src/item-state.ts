import type { Question } from "@interview-kit/schema";

export function markQuestionEdited(question: Question): Question {
  return { ...question, edited: true };
}

export function toggleQuestionPinned(question: Question): Question {
  return { ...question, pinned: !question.pinned };
}

export function mustSurviveRegeneration(question: Question): boolean {
  return question.origin === "user" || question.edited === true || question.pinned === true;
}

export function normalizePrompt(prompt: string): string {
  return prompt
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function recordQuestionTombstone(
  tombstones: Readonly<Record<string, readonly string[]>>,
  question: Question,
): Record<string, string[]> {
  if (question.origin === "user") return copyTombstones(tombstones);
  const normalized = normalizePrompt(question.prompt);
  const existing = tombstones[question.category] ?? [];
  return {
    ...copyTombstones(tombstones),
    [question.category]: [...new Set([...existing, normalized])],
  };
}

function copyTombstones(
  tombstones: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(tombstones).map(([category, prompts]) => [category, [...prompts]]),
  );
}
