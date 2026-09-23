import { allocateSchedule, checkKitReferences, findGaps } from "@interview-kit/logic";
import { kitSchema, type Flashcard, type Kit, type Question } from "@interview-kit/schema";

import { PipelineError } from "./errors";
import { fallbackQuestion } from "./questions";

export function validateKit(kit: unknown): Kit {
  const parsed = kitSchema.safeParse(kit);
  if (!parsed.success) {
    throw new PipelineError(
      "KIT_INVALID",
      "The generated kit does not match the required structure.",
    );
  }
  const issues = checkKitReferences(parsed.data);
  if (issues.length > 0) throw new PipelineError("KIT_INVALID", issues[0]!.message);
  const gaps = findGaps(parsed.data.role.requirements, parsed.data.questions);
  if (gaps.must.length > 0) {
    throw new PipelineError("KIT_INVALID", "The kit has an uncovered must-have requirement.");
  }
  if (parsed.data.schedule.days.length !== parsed.data.schedule.days_available) {
    throw new PipelineError(
      "KIT_INVALID",
      "The schedule does not contain the requested number of days.",
    );
  }
  return parsed.data;
}

function uniqueQuestions(questions: readonly Question[]): Question[] {
  const seen = new Set<string>();
  return questions.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function rebuildCards(questions: readonly Question[]): Flashcard[] {
  return questions.map((question, index) => ({
    id: `f${index + 1}`,
    front: question.prompt,
    back: question.answer_outline,
    requirement_ids: [...question.requirement_ids],
    question_id: question.id,
    origin: "generated",
    edited: false,
    pinned: false,
    generated_by: "fallback",
  }));
}

export function repairKit(kit: Kit, allowedSourceUrls: ReadonlySet<string>): Kit {
  const requirementIds = new Set(kit.role.requirements.map(({ id }) => id));
  const questions = uniqueQuestions(kit.questions)
    .map((question) => ({
      ...question,
      requirement_ids: [...new Set(question.requirement_ids)]
        .filter((id) => requirementIds.has(id))
        .slice(0, 3),
    }))
    .filter(({ requirement_ids }) => requirement_ids.length > 0);
  for (const id of findGaps(kit.role.requirements, questions).all) {
    const requirement = kit.role.requirements.find((candidate) => candidate.id === id);
    if (requirement !== undefined)
      questions.push(fallbackQuestion(requirement, `q${questions.length + 1}`));
  }
  const questionIds = new Set(questions.map(({ id }) => id));
  let flashcards = kit.flashcards.filter(
    (card, index, all) =>
      all.findIndex(({ id }) => id === card.id) === index &&
      card.requirement_ids.length > 0 &&
      card.requirement_ids.every((id) => requirementIds.has(id)) &&
      (card.question_id === undefined || questionIds.has(card.question_id)),
  );
  if (flashcards.length === 0 && questions.length > 0) flashcards = rebuildCards(questions);
  const schedule = allocateSchedule({
    requirements: kit.role.requirements,
    questions,
    flashcards,
    daysAvailable: kit.schedule.days_available,
  });
  const coverageGaps = findGaps(kit.role.requirements, questions);
  return {
    ...kit,
    source: {
      ...kit.source,
      pages_used: [...new Set(kit.source.pages_used)].filter((url) => allowedSourceUrls.has(url)),
    },
    company_brief: {
      ...kit.company_brief,
      sources: [...new Set(kit.company_brief.sources)].filter((url) => allowedSourceUrls.has(url)),
    },
    questions,
    flashcards,
    schedule,
    coverage: { ...kit.coverage, uncovered_requirement_ids: coverageGaps.all },
    ...(kit.hiring_process === undefined
      ? {}
      : {
          hiring_process:
            kit.hiring_process === null
              ? null
              : {
                  ...kit.hiring_process,
                  sources: kit.hiring_process.sources.filter((url) => allowedSourceUrls.has(url)),
                },
        }),
  };
}
