import type { Kit } from "@interview-kit/schema";

export type ReferenceIssueCode =
  | "DUPLICATE_REQUIREMENT_ID"
  | "DUPLICATE_QUESTION_ID"
  | "DUPLICATE_FLASHCARD_ID"
  | "UNKNOWN_QUESTION_REQUIREMENT"
  | "UNKNOWN_FLASHCARD_REQUIREMENT"
  | "UNKNOWN_FLASHCARD_QUESTION"
  | "UNKNOWN_SCHEDULE_QUESTION"
  | "SCHEDULE_DAY_COUNT"
  | "NONSEQUENTIAL_SCHEDULE_DAY";

export interface ReferenceIssue {
  code: ReferenceIssueCode;
  path: string;
  message: string;
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export function checkKitReferences(kit: Kit): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const requirementIds = new Set(kit.role.requirements.map(({ id }) => id));
  const questionIds = new Set(kit.questions.map(({ id }) => id));

  for (const id of duplicateIds(kit.role.requirements.map(({ id }) => id))) {
    issues.push({
      code: "DUPLICATE_REQUIREMENT_ID",
      path: "role.requirements",
      message: `Requirement id ${id} is duplicated.`,
    });
  }
  for (const id of duplicateIds(kit.questions.map(({ id }) => id))) {
    issues.push({
      code: "DUPLICATE_QUESTION_ID",
      path: "questions",
      message: `Question id ${id} is duplicated.`,
    });
  }
  for (const id of duplicateIds(kit.flashcards.map(({ id }) => id))) {
    issues.push({
      code: "DUPLICATE_FLASHCARD_ID",
      path: "flashcards",
      message: `Flashcard id ${id} is duplicated.`,
    });
  }

  kit.questions.forEach((question, questionIndex) => {
    question.requirement_ids.forEach((id, referenceIndex) => {
      if (!requirementIds.has(id)) {
        issues.push({
          code: "UNKNOWN_QUESTION_REQUIREMENT",
          path: `questions.${questionIndex}.requirement_ids.${referenceIndex}`,
          message: `Question ${question.id} references unknown requirement ${id}.`,
        });
      }
    });
  });

  kit.flashcards.forEach((card, cardIndex) => {
    if (card.question_id !== undefined && !questionIds.has(card.question_id)) {
      issues.push({
        code: "UNKNOWN_FLASHCARD_QUESTION",
        path: `flashcards.${cardIndex}.question_id`,
        message: `Flashcard ${card.id} references unknown question ${card.question_id}.`,
      });
    }
    card.requirement_ids.forEach((id, referenceIndex) => {
      if (!requirementIds.has(id)) {
        issues.push({
          code: "UNKNOWN_FLASHCARD_REQUIREMENT",
          path: `flashcards.${cardIndex}.requirement_ids.${referenceIndex}`,
          message: `Flashcard ${card.id} references unknown requirement ${id}.`,
        });
      }
    });
  });

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    issues.push({
      code: "SCHEDULE_DAY_COUNT",
      path: "schedule.days",
      message: "Schedule day count does not match days_available.",
    });
  }

  kit.schedule.days.forEach((day, dayIndex) => {
    if (day.day !== dayIndex + 1) {
      issues.push({
        code: "NONSEQUENTIAL_SCHEDULE_DAY",
        path: `schedule.days.${dayIndex}.day`,
        message: `Expected schedule day ${dayIndex + 1}, received ${day.day}.`,
      });
    }
    day.question_ids.forEach((id, referenceIndex) => {
      if (!questionIds.has(id)) {
        issues.push({
          code: "UNKNOWN_SCHEDULE_QUESTION",
          path: `schedule.days.${dayIndex}.question_ids.${referenceIndex}`,
          message: `Schedule day ${day.day} references unknown question ${id}.`,
        });
      }
    });
  });

  return issues;
}
