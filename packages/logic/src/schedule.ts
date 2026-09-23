import type {
  Flashcard,
  Question,
  QuestionCategory,
  Requirement,
  Schedule,
} from "@interview-kit/schema";

export interface AllocateScheduleInput {
  requirements: readonly Requirement[];
  questions: readonly Question[];
  flashcards: readonly Flashcard[];
  daysAvailable: number;
}

const CATEGORY_ORDER: Record<QuestionCategory, number> = {
  technical: 0,
  "system-design": 1,
  behavioural: 2,
  "company-fit": 3,
};

interface RankedQuestion {
  question: Question;
  mustLinked: boolean;
  originalIndex: number;
}

function difficultyMinutes(difficulty: number): number {
  if (difficulty === 3) return 25;
  if (difficulty === 2) return 15;
  return 10;
}

function rankQuestions(
  requirements: readonly Requirement[],
  questions: readonly Question[],
): RankedQuestion[] {
  const mustIds = new Set(
    requirements.filter(({ priority }) => priority === "must").map(({ id }) => id),
  );
  return questions
    .map((question, originalIndex) => ({
      question,
      originalIndex,
      mustLinked: question.requirement_ids.some((id) => mustIds.has(id)),
    }))
    .sort(
      (left, right) =>
        Number(right.mustLinked) - Number(left.mustLinked) ||
        right.question.difficulty - left.question.difficulty ||
        CATEGORY_ORDER[left.question.category] - CATEGORY_ORDER[right.question.category] ||
        left.originalIndex - right.originalIndex,
    );
}

function partitionContiguously(
  items: readonly RankedQuestion[],
  groupCount: number,
): RankedQuestion[][] {
  const weights = items.map(({ question }) => difficultyMinutes(question.difficulty));
  const prefix = [0];
  for (const weight of weights) prefix.push(prefix[prefix.length - 1]! + weight);

  const cost = Array.from({ length: groupCount + 1 }, () =>
    Array<number>(items.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  const split = Array.from({ length: groupCount + 1 }, () =>
    Array<number>(items.length + 1).fill(-1),
  );
  cost[0]![0] = 0;

  for (let groups = 1; groups <= groupCount; groups += 1) {
    for (let end = groups; end <= items.length; end += 1) {
      for (let start = groups - 1; start < end; start += 1) {
        const segmentWeight = prefix[end]! - prefix[start]!;
        const candidate = Math.max(cost[groups - 1]![start]!, segmentWeight);
        if (candidate < cost[groups]![end]!) {
          cost[groups]![end] = candidate;
          split[groups]![end] = start;
        }
      }
    }
  }

  const groups: RankedQuestion[][] = [];
  let end = items.length;
  for (let remaining = groupCount; remaining > 0; remaining -= 1) {
    const start = split[remaining]![end]!;
    groups.unshift(items.slice(start, end));
    end = start;
  }
  return groups;
}

function makeDay(
  day: number,
  ranked: readonly RankedQuestion[],
  requirements: readonly Requirement[],
  flashcards: readonly Flashcard[],
  focusOverride?: string,
) {
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const coveredIds = new Set(ranked.flatMap(({ question }) => question.requirement_ids));
  const hasRelatedFlashcard = flashcards.some((card) =>
    card.requirement_ids.some((id) => coveredIds.has(id)),
  );
  const first = ranked[0]?.question;
  const firstRequirement = first?.requirement_ids
    .map((id) => requirementById.get(id))
    .find((requirement) => requirement !== undefined);
  const focus =
    focusOverride ??
    (first
      ? `${first.category}: ${firstRequirement?.text ?? first.prompt}`
      : "Review the company brief and job description");
  const minutes = ranked.reduce(
    (total, { question }) => total + difficultyMinutes(question.difficulty),
    0,
  );
  return {
    day,
    focus,
    question_ids: ranked.map(({ question }) => question.id),
    minutes: minutes + (hasRelatedFlashcard ? 10 : 0),
  };
}

export function allocateSchedule(input: AllocateScheduleInput): Schedule {
  if (!Number.isInteger(input.daysAvailable) || input.daysAvailable < 1) {
    throw new RangeError("daysAvailable must be a positive integer.");
  }
  const ranked = rankQuestions(input.requirements, input.questions);
  if (ranked.length === 0) {
    return {
      days_available: input.daysAvailable,
      days: Array.from({ length: input.daysAvailable }, (_, index) => ({
        day: index + 1,
        focus: "Review the company brief and job description",
        question_ids: [],
        minutes: 30,
      })),
    };
  }

  if (input.daysAvailable === 1) {
    return {
      days_available: 1,
      days: [makeDay(1, ranked, input.requirements, input.flashcards)],
    };
  }

  if (ranked.length >= input.daysAvailable) {
    const groups = partitionContiguously(ranked, input.daysAvailable);
    return {
      days_available: input.daysAvailable,
      days: groups.map((group, index) =>
        makeDay(index + 1, group, input.requirements, input.flashcards),
      ),
    };
  }

  const mustFirst = ranked.filter(({ mustLinked }) => mustLinked);
  const reviewPool = mustFirst.length > 0 ? mustFirst : ranked;
  const days = ranked.map((question, index) =>
    makeDay(index + 1, [question], input.requirements, input.flashcards),
  );
  while (days.length < input.daysAvailable - 1) {
    const review = reviewPool[(days.length - ranked.length) % reviewPool.length]!;
    const requirementId = review.question.requirement_ids[0];
    const requirement = input.requirements.find(({ id }) => id === requirementId);
    days.push(
      makeDay(
        days.length + 1,
        [review],
        input.requirements,
        input.flashcards,
        `Review: ${requirement?.text ?? review.question.prompt}`,
      ),
    );
  }
  days.push(
    makeDay(
      input.daysAvailable,
      reviewPool,
      input.requirements,
      input.flashcards,
      "Full run-through",
    ),
  );
  return { days_available: input.daysAvailable, days };
}
