import type { Flashcard, Requirement } from "@interview-kit/schema";

export interface CardReview {
  cardId: string;
  confidence: 1 | 2 | 3 | 4;
  reviewedAt: string;
}

export interface PracticeProgress {
  coveredCardIds: string[];
  uncoveredCardIds: string[];
  coveredCount: number;
  totalCount: number;
  coveredRatio: number;
}

function latestReviews(reviews: readonly CardReview[]): Map<string, CardReview> {
  const latest = new Map<string, CardReview>();
  for (const review of reviews) {
    const current = latest.get(review.cardId);
    if (current === undefined || review.reviewedAt > current.reviewedAt) {
      latest.set(review.cardId, review);
    }
  }
  return latest;
}

export function orderPracticeSession(
  flashcards: readonly Flashcard[],
  reviews: readonly CardReview[],
): string[] {
  const latest = latestReviews(reviews);
  return flashcards
    .map((card, originalIndex) => ({ card, originalIndex, review: latest.get(card.id) }))
    .sort((left, right) => {
      const leftBucket = left.review?.confidence ?? 1;
      const rightBucket = right.review?.confidence ?? 1;
      if (leftBucket !== rightBucket) return leftBucket - rightBucket;
      const leftTime = left.review?.reviewedAt ?? "";
      const rightTime = right.review?.reviewedAt ?? "";
      if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
      return left.originalIndex - right.originalIndex;
    })
    .map(({ card }) => card.id);
}

export function getPracticeProgress(
  flashcards: readonly Flashcard[],
  reviews: readonly CardReview[],
): PracticeProgress {
  const reviewedIds = new Set(latestReviews(reviews).keys());
  const coveredCardIds = flashcards.filter(({ id }) => reviewedIds.has(id)).map(({ id }) => id);
  const uncoveredCardIds = flashcards.filter(({ id }) => !reviewedIds.has(id)).map(({ id }) => id);
  return {
    coveredCardIds,
    uncoveredCardIds,
    coveredCount: coveredCardIds.length,
    totalCount: flashcards.length,
    coveredRatio: flashcards.length === 0 ? 0 : coveredCardIds.length / flashcards.length,
  };
}

export function getRequirementReadiness(
  requirements: readonly Requirement[],
  flashcards: readonly Flashcard[],
  reviews: readonly CardReview[],
): Record<string, boolean> {
  const latest = latestReviews(reviews);
  return Object.fromEntries(
    requirements.map((requirement) => {
      const associated = flashcards.filter(({ requirement_ids }) =>
        requirement_ids.includes(requirement.id),
      );
      const ready =
        associated.length > 0 &&
        associated.every((card) => (latest.get(card.id)?.confidence ?? 0) >= 3);
      return [requirement.id, ready];
    }),
  );
}
