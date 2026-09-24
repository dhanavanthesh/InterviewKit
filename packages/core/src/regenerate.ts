import {
  allocateSchedule,
  findGaps,
  mergeCompanyBrief,
  mergeQuestionCategory,
} from "@interview-kit/logic";
import {
  kitSchema,
  type Flashcard,
  type Kit,
  type Question,
  type QuestionCategory,
} from "@interview-kit/schema";

import { validateKit } from "./assembly";
import { crawlCompanySite } from "./crawler";
import { KitTokenBudget } from "./limiter";
import { fallbackQuestion, generateCoveredQuestions } from "./questions";
import { generateResearch } from "./research-generation";
import type { PipelineDependencies } from "./types";

export type RegenerationRequest =
  | { section: "company_brief" }
  | { section: "questions"; category: QuestionCategory }
  | { section: "schedule" };

function nextQuestionNumber(questions: readonly Question[]): number {
  return Math.max(0, ...questions.map(({ id }) => Number(/^q(\d+)$/.exec(id)?.[1] ?? 0))) + 1;
}

function requirementsForCategory(kit: Kit, category: QuestionCategory) {
  if (category === "behavioural")
    return kit.role.requirements.filter(({ kind }) => kind === "behavioural");
  if (category === "company-fit")
    return kit.role.requirements.filter(({ kind }) => kind === "behavioural" || kind === "domain");
  return kit.role.requirements.filter(({ kind }) => kind === "technical" || kind === "domain");
}

// Replaced questions take their untouched generated cards with them; kept cards lose only the stale link.
function reconcileFlashcards(kit: Kit, questions: readonly Question[]): Flashcard[] {
  const questionIds = new Set(questions.map(({ id }) => id));
  const kept = kit.flashcards.flatMap((card): Flashcard[] => {
    if (card.question_id === undefined || questionIds.has(card.question_id)) return [card];
    if (card.origin !== "user" && card.edited !== true && card.pinned !== true) return [];
    const unlinked: Flashcard = { ...card };
    delete unlinked.question_id;
    return [unlinked];
  });
  const originalIds = new Set(kit.questions.map(({ id }) => id));
  const linked = new Set(kept.map(({ question_id }) => question_id));
  let next =
    Math.max(0, ...kit.flashcards.map(({ id }) => Number(/^f(\d+)$/.exec(id)?.[1] ?? 0))) + 1;
  const added = questions
    .filter(({ id }) => !originalIds.has(id) && !linked.has(id))
    .map((question): Flashcard => ({
      id: `f${next++}`,
      front: question.prompt,
      back: question.answer_outline.trim() || question.prompt,
      requirement_ids: [...question.requirement_ids],
      question_id: question.id,
      origin: "generated",
      edited: false,
      pinned: false,
      generated_by: "fallback",
    }));
  return [...kept, ...added];
}

function closeCoverage(kit: Kit, questions: Question[]): Question[] {
  for (const id of findGaps(kit.role.requirements, questions).all) {
    const requirement = kit.role.requirements.find((candidate) => candidate.id === id);
    if (requirement !== undefined)
      questions.push(fallbackQuestion(requirement, `q${nextQuestionNumber(questions)}`));
  }
  return questions;
}

export async function regenerateSection(
  kit: Kit,
  request: RegenerationRequest,
  dependencies: PipelineDependencies,
): Promise<Kit> {
  if (request.section === "schedule") {
    return kitSchema.parse({
      ...kit,
      schedule: allocateSchedule({
        requirements: kit.role.requirements,
        questions: kit.questions,
        flashcards: kit.flashcards,
        daysAvailable: kit.schedule.days_available,
      }),
    });
  }
  const budget = new KitTokenBudget(dependencies.config.kitTokenBudget);
  if (request.section === "company_brief") {
    const crawl = await crawlCompanySite(
      kit.source.company_url,
      { fetcher: dependencies.fetcher, config: dependencies.config, clock: dependencies.clock },
      dependencies.signal,
    );
    const research = await generateResearch({
      crawl,
      discussionResult: { hits: [], failed: false },
      companyUrl: kit.source.company_url,
      ...(dependencies.llm === undefined ? {} : { llm: dependencies.llm }),
      config: dependencies.config,
      budget,
      ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
    });
    return kitSchema.parse({
      ...kit,
      company_brief: mergeCompanyBrief(
        {
          summary: kit.company_brief.summary,
          what_they_do: kit.company_brief.what_they_do,
          sources: kit.company_brief.sources,
          ...(kit.company_brief.summary_edited === undefined
            ? {}
            : { summary_edited: kit.company_brief.summary_edited }),
          ...(kit.company_brief.what_they_do_edited === undefined
            ? {}
            : { what_they_do_edited: kit.company_brief.what_they_do_edited }),
        },
        {
          summary: research.companyBrief.summary,
          what_they_do: research.companyBrief.what_they_do,
          sources: research.companyBrief.sources,
          ...(research.companyBrief.summary_edited === undefined
            ? {}
            : { summary_edited: research.companyBrief.summary_edited }),
          ...(research.companyBrief.what_they_do_edited === undefined
            ? {}
            : { what_they_do_edited: research.companyBrief.what_they_do_edited }),
        },
      ),
    });
  }

  const categoryRequirements = requirementsForCategory(kit, request.category);
  const generated = await generateCoveredQuestions({
    requirements: categoryRequirements,
    groups: [{ category: request.category, requirements: categoryRequirements }],
    ...(dependencies.llm === undefined ? {} : { llm: dependencies.llm }),
    config: dependencies.config,
    budget,
    hiringText: kit.hiring_process?.stages.join(" ") ?? "",
    companyContext: `${kit.company_brief.summary} ${kit.company_brief.what_they_do}`,
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
  const merged = mergeQuestionCategory({
    existingQuestions: kit.questions,
    category: request.category,
    generatedQuestions: generated.questions,
    tombstones: kit.tombstones ?? {},
    nextQuestionNumber: nextQuestionNumber(kit.questions),
  });
  const questions = closeCoverage(kit, merged.questions);
  const flashcards = reconcileFlashcards(kit, questions);
  const schedule = allocateSchedule({
    requirements: kit.role.requirements,
    questions,
    flashcards,
    daysAvailable: kit.schedule.days_available,
  });
  return validateKit({
    ...kit,
    questions,
    flashcards,
    schedule,
    coverage: {
      ...kit.coverage,
      uncovered_requirement_ids: findGaps(kit.role.requirements, questions).all,
    },
  });
}
