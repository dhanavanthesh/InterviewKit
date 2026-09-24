import { Router } from "express";
import {
  getPracticeProgress,
  getRequirementReadiness,
  orderPracticeSession,
} from "@interview-kit/logic";
import { z } from "zod";

import type { ApiDependencies } from "../dependencies";
import { ApiError, asyncRoute } from "../errors";
import { authenticatedUser } from "../middleware/auth";
import { parseBody, parseParams } from "../middleware/validate";
import { requireReadyKit } from "../services/mutation";

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const reviewSchema = z.object({
  card_id: z.string().min(1).max(128),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export function practiceRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get(
    "/:id/practice/session",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, paramsSchema);
      const record = await requireReadyKit(dependencies.repositories, owner.id, id);
      const reviews = await dependencies.repositories.reviews.listOwned(owner.id, id);
      const logicalReviews = reviews.map((review) => ({
        cardId: review.cardId,
        confidence: review.confidence,
        reviewedAt: review.reviewedAt.toISOString(),
      }));
      const orderedIds = orderPracticeSession(record.kit.flashcards, logicalReviews);
      const byId = new Map(record.kit.flashcards.map((card) => [card.id, card]));
      response.json({ card_ids: orderedIds, cards: orderedIds.map((cardId) => byId.get(cardId)) });
    }),
  );

  router.post(
    "/:id/practice/reviews",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, paramsSchema);
      const body = parseBody(request, reviewSchema);
      const record = await requireReadyKit(dependencies.repositories, owner.id, id);
      if (!record.kit.flashcards.some(({ id: cardId }) => cardId === body.card_id))
        throw new ApiError("NOT_FOUND", "The flashcard was not found.");
      const review = await dependencies.repositories.reviews.create({
        ownerId: owner.id,
        kitId: id,
        cardId: body.card_id,
        confidence: body.confidence,
        reviewedAt: new Date(),
      });
      response.status(201).json({
        id: review.id,
        card_id: review.cardId,
        confidence: review.confidence,
        reviewed_at: review.reviewedAt.toISOString(),
      });
    }),
  );

  router.get(
    "/:id/practice/progress",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, paramsSchema);
      const record = await requireReadyKit(dependencies.repositories, owner.id, id);
      const reviews = await dependencies.repositories.reviews.listOwned(owner.id, id);
      const logicalReviews = reviews.map((review) => ({
        cardId: review.cardId,
        confidence: review.confidence,
        reviewedAt: review.reviewedAt.toISOString(),
      }));
      response.json({
        ...getPracticeProgress(record.kit.flashcards, logicalReviews),
        requirement_readiness: getRequirementReadiness(
          record.kit.role.requirements,
          record.kit.flashcards,
          logicalReviews,
        ),
      });
    }),
  );

  return router;
}
