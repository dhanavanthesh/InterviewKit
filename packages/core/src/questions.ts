import { findGaps } from "@interview-kit/logic";
import type { Flashcard, Question, QuestionCategory, Requirement } from "@interview-kit/schema";
import { z } from "zod";

import type { KitTokenBudget } from "./limiter";
import { normalizeForComparison } from "./preprocess";
import type { LlmClient, PipelineConfig } from "./types";

const draftQuestionSchema = z.object({
  requirement_ids: z.array(z.string()),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number(),
});
const questionBatchSchema = z.object({ questions: z.array(draftQuestionSchema) });
const flashcardBatchSchema = z.object({
  flashcards: z.array(
    z.object({
      question_id: z.string(),
      requirement_ids: z.array(z.string()),
      front: z.string().min(1),
      back: z.string(),
    }),
  ),
});

export interface CategoryGroup {
  category: QuestionCategory;
  requirements: Requirement[];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

export function planQuestionCategories(input: {
  requirements: readonly Requirement[];
  seniority: string;
  hiringText: string;
  hasCompanyBrief: boolean;
}): CategoryGroup[] {
  const technical = input.requirements.filter(
    ({ kind }) => kind === "technical" || kind === "domain",
  );
  const behavioural = input.requirements.filter(({ kind }) => kind === "behavioural");
  const companyFit = input.requirements.filter(
    ({ kind }) => kind === "behavioural" || kind === "domain",
  );
  const groups: CategoryGroup[] = [];
  chunks(technical, 5).forEach((requirements) =>
    groups.push({ category: "technical", requirements }),
  );
  chunks(behavioural, 5).forEach((requirements) =>
    groups.push({ category: "behavioural", requirements }),
  );
  const needsSystemDesign =
    technical.length > 0 &&
    (/\b(system[ -]?design|architecture)\b/i.test(input.hiringText) ||
      /\b(senior|staff|lead|principal)\b/i.test(input.seniority));
  if (needsSystemDesign) {
    chunks(technical, 5).forEach((requirements) =>
      groups.push({ category: "system-design", requirements }),
    );
  }
  if (input.hasCompanyBrief && companyFit.length > 0) {
    chunks(companyFit, 5).forEach((requirements) =>
      groups.push({ category: "company-fit", requirements }),
    );
  }
  return groups;
}

const STOP_WORDS = new Set([
  "about",
  "could",
  "describe",
  "experience",
  "have",
  "how",
  "into",
  "most",
  "question",
  "that",
  "their",
  "this",
  "through",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    normalizeForComparison(value)
      .split(/[^\p{L}\p{N}+#.]+/u)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function overlapsRequirement(questionText: string, requirement: Requirement): boolean {
  const questionTokens = meaningfulTokens(questionText);
  const requirementTokens = meaningfulTokens(`${requirement.text} ${requirement.evidence ?? ""}`);
  for (const token of requirementTokens) if (questionTokens.has(token)) return true;
  return false;
}

export function validateQuestionDrafts(input: {
  drafts: readonly z.infer<typeof draftQuestionSchema>[];
  category: QuestionCategory;
  allowedRequirements: readonly Requirement[];
  startNumber: number;
  generatedBy: "draft" | "gap";
}): Question[] {
  const requirementById = new Map(
    input.allowedRequirements.map((requirement) => [requirement.id, requirement]),
  );
  const seenPrompts = new Set<string>();
  const questions: Question[] = [];
  let next = input.startNumber;
  for (const draft of input.drafts) {
    const promptKey = normalizeForComparison(draft.prompt);
    if (seenPrompts.has(promptKey)) continue;
    const linked = [...new Set(draft.requirement_ids)]
      .filter((id) => {
        const requirement = requirementById.get(id);
        return (
          requirement !== undefined &&
          overlapsRequirement(`${draft.prompt} ${draft.answer_outline}`, requirement)
        );
      })
      .slice(0, 3);
    if (linked.length === 0) continue;
    seenPrompts.add(promptKey);
    questions.push({
      id: `q${next}`,
      requirement_ids: linked,
      category: input.category,
      prompt: draft.prompt.trim(),
      answer_outline: draft.answer_outline.trim(),
      difficulty: Math.max(1, Math.min(3, Math.round(draft.difficulty))),
      origin: "generated",
      edited: false,
      pinned: false,
      generated_by: input.generatedBy,
    });
    next += 1;
  }
  return questions;
}

function categoryInstruction(category: QuestionCategory, hiringText: string): string {
  if (category === "behavioural") {
    return "Create STAR-compatible behavioural questions about leadership, communication, mentoring, and ownership. Do not write technical quizzes.";
  }
  if (category === "system-design") {
    return "Create system-design questions covering architecture scope, constraints, scaling, reliability, and trade-offs.";
  }
  if (category === "company-fit") {
    return "Create company-fit questions tied only to the supplied supported company context and requirements. Do not invent culture or values.";
  }
  return /take[ -]?home/i.test(hiringText)
    ? "Create applied technical take-home-style questions about trade-offs, debugging, and production decisions."
    : "Create applied technical questions about trade-offs, debugging, and production decisions.";
}

async function generateGroup(input: {
  llm: LlmClient;
  group: CategoryGroup;
  config: PipelineConfig;
  budget: KitTokenBudget;
  hiringText: string;
  companyContext: string;
  nextQuestionNumber: number;
  generatedBy: "draft" | "gap";
  signal?: AbortSignal;
}): Promise<Question[]> {
  const tokenCap = input.generatedBy === "gap" ? 800 : 1100;
  if (!input.budget.canReserve(tokenCap)) return [];
  const response = await input.llm.complete({
    model: input.config.mainModel,
    system: `${categoryInstruction(input.group.category, input.hiringText)} Every question must reference only supplied requirement IDs and mention the underlying skill or behavior meaningfully.`,
    data: {
      category: input.group.category,
      requirements: input.group.requirements,
      hiring_context: input.hiringText,
      company_context: input.companyContext,
    },
    schema: questionBatchSchema,
    schemaName: `${input.group.category.replace("-", "_")}_questions`,
    maxCompletionTokens: tokenCap,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    category: input.generatedBy === "gap" ? "gap" : input.group.category,
  });
  input.budget.record(response.usage);
  return validateQuestionDrafts({
    drafts: response.value.questions,
    category: input.group.category,
    allowedRequirements: input.group.requirements,
    startNumber: input.nextQuestionNumber,
    generatedBy: input.generatedBy,
  });
}

export function fallbackQuestion(requirement: Requirement, id: string): Question {
  const category: QuestionCategory =
    requirement.kind === "behavioural" ? "behavioural" : "technical";
  const prompt =
    requirement.kind === "behavioural"
      ? `Tell me about a time you demonstrated ${requirement.text}. What was the situation and result?`
      : requirement.kind === "domain"
        ? `How has ${requirement.text} shaped a decision in your previous work?`
        : `Walk me through a production example involving ${requirement.text}. What trade-offs did you make?`;
  return {
    id,
    requirement_ids: [requirement.id],
    category,
    prompt,
    answer_outline:
      requirement.kind === "behavioural"
        ? `Use STAR: situation, task, actions demonstrating ${requirement.text}, and measurable result.`
        : `Explain the context, your approach to ${requirement.text}, alternatives considered, outcome, and lessons learned.`,
    difficulty: 2,
    origin: "generated",
    edited: false,
    pinned: false,
    generated_by: "fallback",
  };
}

export interface QuestionGenerationResult {
  questions: Question[];
  passes: number;
  history: Array<{ pass: number; uncovered_ids: string[] }>;
  degraded: boolean;
}

export async function generateCoveredQuestions(input: {
  requirements: readonly Requirement[];
  groups: readonly CategoryGroup[];
  llm?: LlmClient;
  config: PipelineConfig;
  budget: KitTokenBudget;
  hiringText: string;
  companyContext: string;
  signal?: AbortSignal;
}): Promise<QuestionGenerationResult> {
  if (input.requirements.length === 0)
    return { questions: [], passes: 0, history: [], degraded: false };
  const questions: Question[] = [];
  let degraded = input.llm === undefined;
  if (input.llm !== undefined) {
    for (const group of input.groups) {
      try {
        const generated = await generateGroup({
          llm: input.llm,
          group,
          config: input.config,
          budget: input.budget,
          hiringText: input.hiringText,
          companyContext: input.companyContext,
          nextQuestionNumber: questions.length + 1,
          generatedBy: "draft",
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        questions.push(...generated);
      } catch {
        degraded = true;
      }
    }
  }
  let passes = 1;
  const history = [{ pass: passes, uncovered_ids: findGaps(input.requirements, questions).all }];
  while (
    input.llm !== undefined &&
    history.at(-1)!.uncovered_ids.length > 0 &&
    passes < input.config.maxCoveragePasses
  ) {
    const gaps = history
      .at(-1)!
      .uncovered_ids.map((id) => input.requirements.find((requirement) => requirement.id === id))
      .filter((requirement): requirement is Requirement => requirement !== undefined);
    for (const groupRequirements of chunks(gaps, 3)) {
      const category: QuestionCategory = groupRequirements.every(
        ({ kind }) => kind === "behavioural",
      )
        ? "behavioural"
        : "technical";
      try {
        const generated = await generateGroup({
          llm: input.llm,
          group: { category, requirements: groupRequirements },
          config: input.config,
          budget: input.budget,
          hiringText: input.hiringText,
          companyContext: input.companyContext,
          nextQuestionNumber: questions.length + 1,
          generatedBy: "gap",
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        questions.push(...generated);
      } catch {
        degraded = true;
      }
    }
    passes += 1;
    history.push({ pass: passes, uncovered_ids: findGaps(input.requirements, questions).all });
  }
  const remaining = findGaps(input.requirements, questions).all;
  for (const id of remaining) {
    const requirement = input.requirements.find((candidate) => candidate.id === id);
    if (requirement !== undefined)
      questions.push(fallbackQuestion(requirement, `q${questions.length + 1}`));
  }
  if (remaining.length > 0) {
    degraded = true;
    passes += 1;
    history.push({ pass: passes, uncovered_ids: findGaps(input.requirements, questions).all });
  }
  return { questions, passes, history, degraded };
}

export async function generateFlashcards(input: {
  questions: readonly Question[];
  llm?: LlmClient;
  config: PipelineConfig;
  budget: KitTokenBudget;
  signal?: AbortSignal;
}): Promise<Flashcard[]> {
  if (input.questions.length === 0) return [];
  if (input.llm !== undefined && input.budget.canReserve(1000)) {
    try {
      const response = await input.llm.complete({
        model: input.config.lightModel,
        system:
          "Create one concise study flashcard per supplied question. Copy only its real question and requirement IDs.",
        data: input.questions,
        schema: flashcardBatchSchema,
        schemaName: "flashcards",
        maxCompletionTokens: 1000,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        optional: true,
        category: "flashcards",
      });
      input.budget.record(response.usage);
      const questionById = new Map(input.questions.map((question) => [question.id, question]));
      const cards: Flashcard[] = [];
      for (const draft of response.value.flashcards) {
        const question = questionById.get(draft.question_id);
        if (question === undefined) continue;
        const ids = [...new Set(draft.requirement_ids)].filter((id) =>
          question.requirement_ids.includes(id),
        );
        if (ids.length === 0) continue;
        cards.push({
          id: `f${cards.length + 1}`,
          front: draft.front,
          back: draft.back,
          requirement_ids: ids,
          question_id: question.id,
          origin: "generated",
          edited: false,
          pinned: false,
          generated_by: "draft",
        });
      }
      if (cards.length > 0) return cards;
    } catch {
      // Deterministic cards keep the kit usable when optional generation fails.
    }
  }
  return input.questions.map((question, index) => ({
    id: `f${index + 1}`,
    front: question.prompt,
    back: question.answer_outline,
    requirement_ids: [...question.requirement_ids],
    question_id: question.id,
    origin: "generated" as const,
    edited: false,
    pinned: false,
    generated_by: "fallback" as const,
  }));
}
