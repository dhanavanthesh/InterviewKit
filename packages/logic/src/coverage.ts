import type { Question, Requirement } from "@interview-kit/schema";

export interface CoverageGaps {
  all: string[];
  must: string[];
  nice: string[];
}

export function findGaps(
  requirements: readonly Requirement[],
  questions: readonly Question[],
): CoverageGaps {
  const validIds = new Set(requirements.map(({ id }) => id));
  const covered = new Set<string>();
  for (const question of questions) {
    for (const id of question.requirement_ids) {
      if (validIds.has(id)) covered.add(id);
    }
  }

  const uncovered = requirements.filter(({ id }) => !covered.has(id));
  return {
    all: uncovered.map(({ id }) => id),
    must: uncovered.filter(({ priority }) => priority === "must").map(({ id }) => id),
    nice: uncovered.filter(({ priority }) => priority === "nice").map(({ id }) => id),
  };
}
