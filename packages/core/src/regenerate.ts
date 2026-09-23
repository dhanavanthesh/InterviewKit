import {
  allocateSchedule,
  findGaps,
  mergeCompanyBrief,
  mergeQuestionCategory,
} from "@interview-kit/logic";
import type { Kit, Question, QuestionCategory } from "@interview-kit/schema";

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
    return validateKit({
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
    return validateKit({
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
  const schedule = allocateSchedule({
    requirements: kit.role.requirements,
    questions,
    flashcards: kit.flashcards,
    daysAvailable: kit.schedule.days_available,
  });
  return validateKit({
    ...kit,
    questions,
    schedule,
    coverage: {
      ...kit.coverage,
      uncovered_requirement_ids: findGaps(kit.role.requirements, questions).all,
    },
  });
}
