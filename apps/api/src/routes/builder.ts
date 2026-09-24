import { Router } from "express";
import { allocateSchedule, findGaps, recordQuestionTombstone } from "@interview-kit/logic";
import {
  questionCategorySchema,
  requirementKindSchema,
  requirementPrioritySchema,
} from "@interview-kit/schema";
import { z } from "zod";

import type { ApiDependencies } from "../dependencies";
import { ApiError, asyncRoute } from "../errors";
import { authenticatedUser } from "../middleware/auth";
import { parseBody, parseParams } from "../middleware/validate";
import { sectionKey } from "../services/job-runner";
import { mutateOwnedKit, requireReadyKit } from "../services/mutation";

const text = (max: number) => z.string().max(max);
const kitParams = z.object({ id: z.string().min(1).max(128) });
const requirementParams = kitParams.extend({ rid: z.string().min(1).max(128) });
const questionParams = kitParams.extend({ qid: z.string().min(1).max(128) });
const flashcardParams = kitParams.extend({ fid: z.string().min(1).max(128) });
const dayParams = kitParams.extend({ day: z.coerce.number().int().positive() });

const briefSchema = z
  .object({ summary: text(5000).optional(), what_they_do: text(5000).optional() })
  .refine((value) => Object.keys(value).length > 0);
const roleSchema = z
  .object({
    title: text(300).optional(),
    seniority: text(200).optional(),
    responsibilities: z.array(text(1000)).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
const requirementCreateSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});
const requirementPatchSchema = requirementCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const questionCreateSchema = z.object({
  prompt: z.string().trim().min(1).max(5000),
  answer_outline: text(10_000),
  difficulty: z.number().int().min(1).max(3),
  category: questionCategorySchema,
  requirement_ids: z.array(z.string().min(1)).min(1).max(3),
  pinned: z.boolean().optional(),
});
const questionPatchSchema = questionCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const questionOrderSchema = z.object({
  category: questionCategorySchema,
  ordered_ids: z.array(z.string().min(1)),
});
const flashcardCreateSchema = z.object({
  front: z.string().trim().min(1).max(5000),
  back: text(10_000),
  requirement_ids: z.array(z.string().min(1)).min(1),
  question_id: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
});
const flashcardPatchSchema = flashcardCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const flashcardOrderSchema = z.object({ ordered_ids: z.array(z.string().min(1)) });
const scheduleDaySchema = z
  .object({ focus: text(1000).optional(), minutes: z.number().int().min(1).max(1440).optional() })
  .refine((value) => Object.keys(value).length > 0);
const regenerateSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("company_brief") }),
  z.object({ section: z.literal("questions"), category: questionCategorySchema }),
  z.object({ section: z.literal("schedule"), confirm: z.boolean().optional() }),
]);

function assertRequirementIds(existing: readonly string[], requested: readonly string[]): string[] {
  const unique = [...new Set(requested)];
  if (unique.length !== requested.length || unique.some((id) => !existing.includes(id))) {
    throw new ApiError("KIT_INVALID", "Every requirement ID must exist and be unique.");
  }
  return unique;
}

function exactOrder(current: readonly string[], requested: readonly string[]): void {
  if (
    new Set(requested).size !== requested.length ||
    current.length !== requested.length ||
    current.some((id) => !requested.includes(id))
  ) {
    throw new ApiError("KIT_INVALID", "The ordered IDs must exactly match the current item set.");
  }
}

export function builderRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.patch(
    "/:id/company-brief",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, briefSchema);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => ({
        ...record,
        kit: {
          ...record.kit,
          company_brief: {
            ...record.kit.company_brief,
            ...(body.summary === undefined ? {} : { summary: body.summary, summary_edited: true }),
            ...(body.what_they_do === undefined
              ? {}
              : { what_they_do: body.what_they_do, what_they_do_edited: true }),
          },
        },
      }));
      response.json({ version: saved.version, company_brief: saved.kit.company_brief });
    }),
  );

  router.patch(
    "/:id/role",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, roleSchema);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => ({
        ...record,
        kit: {
          ...record.kit,
          role: {
            ...record.kit.role,
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.seniority === undefined ? {} : { seniority: body.seniority }),
            ...(body.responsibilities === undefined
              ? {}
              : { responsibilities: body.responsibilities }),
          },
        },
      }));
      response.json({ version: saved.version, role: saved.kit.role });
    }),
  );

  router.post(
    "/:id/requirements",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, requirementCreateSchema);
      let createdId = "";
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        let counter = record.counters.requirement + 1;
        const used = new Set(
          record.kit.role.requirements.map(({ id: requirementId }) => requirementId),
        );
        while (used.has(`r${counter}`)) counter += 1;
        createdId = `r${counter}`;
        return {
          ...record,
          counters: { ...record.counters, requirement: counter },
          kit: {
            ...record.kit,
            role: {
              ...record.kit.role,
              requirements: [
                ...record.kit.role.requirements,
                { id: createdId, ...body, origin: "user" },
              ],
            },
          },
        };
      });
      response.status(201).json({
        version: saved.version,
        requirement: saved.kit.role.requirements.find(
          ({ id: requirementId }) => requirementId === createdId,
        ),
      });
    }),
  );

  router.patch(
    "/:id/requirements/:rid",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, rid } = parseParams(request, requirementParams);
      const body = parseBody(request, requirementPatchSchema);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        if (!record.kit.role.requirements.some(({ id: requirementId }) => requirementId === rid))
          throw new ApiError("NOT_FOUND", "The requirement was not found.");
        return {
          ...record,
          kit: {
            ...record.kit,
            role: {
              ...record.kit.role,
              requirements: record.kit.role.requirements.map((item) =>
                item.id === rid
                  ? {
                      ...item,
                      ...(body.text === undefined ? {} : { text: body.text }),
                      ...(body.kind === undefined ? {} : { kind: body.kind }),
                      ...(body.priority === undefined ? {} : { priority: body.priority }),
                      origin: "user" as const,
                    }
                  : item,
              ),
            },
          },
        };
      });
      response.json({
        version: saved.version,
        requirement: saved.kit.role.requirements.find(
          ({ id: requirementId }) => requirementId === rid,
        ),
      });
    }),
  );

  router.delete(
    "/:id/requirements/:rid",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, rid } = parseParams(request, requirementParams);
      const before = await requireReadyKit(dependencies.repositories, owner.id, id);
      if (!before.kit.role.requirements.some(({ id: requirementId }) => requirementId === rid))
        throw new ApiError("NOT_FOUND", "The requirement was not found.");
      const removedCardIds: string[] = [];
      await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        const questions = record.kit.questions
          .map((question) => ({
            ...question,
            requirement_ids: question.requirement_ids.filter((item) => item !== rid),
          }))
          .filter(({ requirement_ids }) => requirement_ids.length > 0);
        const remainingQuestionIds = new Set(questions.map(({ id: questionId }) => questionId));
        const flashcards = record.kit.flashcards
          .map((card) => {
            const { question_id, ...rest } = card;
            return {
              ...rest,
              ...(question_id !== undefined && remainingQuestionIds.has(question_id)
                ? { question_id }
                : {}),
              requirement_ids: card.requirement_ids.filter((item) => item !== rid),
            };
          })
          .filter((card) => {
            if (card.requirement_ids.length === 0) removedCardIds.push(card.id);
            return card.requirement_ids.length > 0;
          });
        return {
          ...record,
          kit: {
            ...record.kit,
            role: {
              ...record.kit.role,
              requirements: record.kit.role.requirements.filter(
                ({ id: requirementId }) => requirementId !== rid,
              ),
            },
            questions,
            flashcards,
          },
        };
      });
      for (const cardId of removedCardIds)
        await dependencies.repositories.reviews.deleteForCard(owner.id, id, cardId);
      response.status(204).end();
    }),
  );

  router.post(
    "/:id/questions",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, questionCreateSchema);
      let createdId = "";
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        const requirementIds = assertRequirementIds(
          record.kit.role.requirements.map(({ id: requirementId }) => requirementId),
          body.requirement_ids,
        );
        let counter = record.counters.question + 1;
        const used = new Set(record.kit.questions.map(({ id: questionId }) => questionId));
        while (used.has(`q${counter}`)) counter += 1;
        createdId = `q${counter}`;
        return {
          ...record,
          counters: { ...record.counters, question: counter },
          kit: {
            ...record.kit,
            questions: [
              ...record.kit.questions,
              {
                ...body,
                requirement_ids: requirementIds,
                id: createdId,
                origin: "user",
                edited: true,
                pinned: body.pinned ?? false,
                generated_by: "user",
              },
            ],
          },
        };
      });
      response.status(201).json({
        version: saved.version,
        question: saved.kit.questions.find(({ id: questionId }) => questionId === createdId),
      });
    }),
  );

  router.patch(
    "/:id/questions/:qid",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, qid } = parseParams(request, questionParams);
      const body = parseBody(request, questionPatchSchema);
      const substantive = [
        "prompt",
        "answer_outline",
        "difficulty",
        "category",
        "requirement_ids",
      ].some((key) => key in body);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        if (!record.kit.questions.some(({ id: questionId }) => questionId === qid))
          throw new ApiError("NOT_FOUND", "The question was not found.");
        const requirementIds =
          body.requirement_ids === undefined
            ? undefined
            : assertRequirementIds(
                record.kit.role.requirements.map(({ id: requirementId }) => requirementId),
                body.requirement_ids,
              );
        return {
          ...record,
          kit: {
            ...record.kit,
            questions: record.kit.questions.map((question) =>
              question.id === qid
                ? {
                    ...question,
                    ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
                    ...(body.answer_outline === undefined
                      ? {}
                      : { answer_outline: body.answer_outline }),
                    ...(body.difficulty === undefined ? {} : { difficulty: body.difficulty }),
                    ...(body.category === undefined ? {} : { category: body.category }),
                    ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
                    ...(requirementIds === undefined ? {} : { requirement_ids: requirementIds }),
                    ...(substantive ? { edited: true } : {}),
                  }
                : question,
            ),
          },
        };
      });
      response.json({
        version: saved.version,
        question: saved.kit.questions.find(({ id: questionId }) => questionId === qid),
      });
    }),
  );

  router.delete(
    "/:id/questions/:qid",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, qid } = parseParams(request, questionParams);
      const deletedCardIds: string[] = [];
      await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        const question = record.kit.questions.find(({ id: questionId }) => questionId === qid);
        if (question === undefined) throw new ApiError("NOT_FOUND", "The question was not found.");
        const flashcards = record.kit.flashcards.flatMap((card) => {
          if (card.question_id !== qid) return [card];
          if (card.origin !== "user" && card.edited !== true && card.pinned !== true) {
            deletedCardIds.push(card.id);
            return [];
          }
          const { question_id: _removedQuestionId, ...retained } = card;
          void _removedQuestionId;
          return [retained];
        });
        return {
          ...record,
          kit: {
            ...record.kit,
            questions: record.kit.questions.filter(({ id: questionId }) => questionId !== qid),
            flashcards,
            tombstones: recordQuestionTombstone(record.kit.tombstones ?? {}, question),
          },
        };
      });
      for (const cardId of deletedCardIds)
        await dependencies.repositories.reviews.deleteForCard(owner.id, id, cardId);
      response.status(204).end();
    }),
  );

  router.put(
    "/:id/questions/order",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, questionOrderSchema);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        const target = record.kit.questions.filter(({ category }) => category === body.category);
        exactOrder(
          target.map(({ id: questionId }) => questionId),
          body.ordered_ids,
        );
        const byId = new Map(target.map((question) => [question.id, question]));
        let cursor = 0;
        const questions = record.kit.questions.map((question) =>
          question.category === body.category ? byId.get(body.ordered_ids[cursor++]!)! : question,
        );
        return { ...record, kit: { ...record.kit, questions } };
      });
      response.json({ version: saved.version, questions: saved.kit.questions });
    }),
  );

  router.post(
    "/:id/flashcards",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, flashcardCreateSchema);
      let createdId = "";
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        const requirementIds = assertRequirementIds(
          record.kit.role.requirements.map(({ id: requirementId }) => requirementId),
          body.requirement_ids,
        );
        if (
          body.question_id !== undefined &&
          !record.kit.questions.some(({ id: questionId }) => questionId === body.question_id)
        )
          throw new ApiError("KIT_INVALID", "The question ID does not exist.");
        let counter = record.counters.flashcard + 1;
        const used = new Set(record.kit.flashcards.map(({ id: cardId }) => cardId));
        while (used.has(`f${counter}`)) counter += 1;
        createdId = `f${counter}`;
        return {
          ...record,
          counters: { ...record.counters, flashcard: counter },
          kit: {
            ...record.kit,
            flashcards: [
              ...record.kit.flashcards,
              {
                ...body,
                requirement_ids: requirementIds,
                id: createdId,
                origin: "user",
                edited: true,
                pinned: body.pinned ?? false,
                generated_by: "user",
              },
            ],
          },
        };
      });
      response.status(201).json({
        version: saved.version,
        flashcard: saved.kit.flashcards.find(({ id: cardId }) => cardId === createdId),
      });
    }),
  );

  router.patch(
    "/:id/flashcards/:fid",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, fid } = parseParams(request, flashcardParams);
      const body = parseBody(request, flashcardPatchSchema);
      const substantive = ["front", "back", "requirement_ids", "question_id"].some(
        (key) => key in body,
      );
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        if (!record.kit.flashcards.some(({ id: cardId }) => cardId === fid))
          throw new ApiError("NOT_FOUND", "The flashcard was not found.");
        const requirementIds =
          body.requirement_ids === undefined
            ? undefined
            : assertRequirementIds(
                record.kit.role.requirements.map(({ id: requirementId }) => requirementId),
                body.requirement_ids,
              );
        if (
          body.question_id !== undefined &&
          !record.kit.questions.some(({ id: questionId }) => questionId === body.question_id)
        )
          throw new ApiError("KIT_INVALID", "The question ID does not exist.");
        return {
          ...record,
          kit: {
            ...record.kit,
            flashcards: record.kit.flashcards.map((card) =>
              card.id === fid
                ? {
                    ...card,
                    ...(body.front === undefined ? {} : { front: body.front }),
                    ...(body.back === undefined ? {} : { back: body.back }),
                    ...(body.question_id === undefined ? {} : { question_id: body.question_id }),
                    ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
                    ...(requirementIds === undefined ? {} : { requirement_ids: requirementIds }),
                    ...(substantive ? { edited: true } : {}),
                  }
                : card,
            ),
          },
        };
      });
      response.json({
        version: saved.version,
        flashcard: saved.kit.flashcards.find(({ id: cardId }) => cardId === fid),
      });
    }),
  );

  router.delete(
    "/:id/flashcards/:fid",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, fid } = parseParams(request, flashcardParams);
      await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        if (!record.kit.flashcards.some(({ id: cardId }) => cardId === fid))
          throw new ApiError("NOT_FOUND", "The flashcard was not found.");
        return {
          ...record,
          kit: {
            ...record.kit,
            flashcards: record.kit.flashcards.filter(({ id: cardId }) => cardId !== fid),
          },
        };
      });
      await dependencies.repositories.reviews.deleteForCard(owner.id, id, fid);
      response.status(204).end();
    }),
  );

  router.put(
    "/:id/flashcards/order",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, flashcardOrderSchema);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        exactOrder(
          record.kit.flashcards.map(({ id: cardId }) => cardId),
          body.ordered_ids,
        );
        const byId = new Map(record.kit.flashcards.map((card) => [card.id, card]));
        return {
          ...record,
          kit: { ...record.kit, flashcards: body.ordered_ids.map((cardId) => byId.get(cardId)!) },
        };
      });
      response.json({ version: saved.version, flashcards: saved.kit.flashcards });
    }),
  );

  router.patch(
    "/:id/schedule/days/:day",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id, day } = parseParams(request, dayParams);
      const body = parseBody(request, scheduleDaySchema);
      const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (record) => {
        if (!record.kit.schedule.days.some((item) => item.day === day))
          throw new ApiError("NOT_FOUND", "The schedule day was not found.");
        return {
          ...record,
          kit: {
            ...record.kit,
            schedule: {
              ...record.kit.schedule,
              edited: true,
              days: record.kit.schedule.days.map((item) =>
                item.day === day
                  ? {
                      ...item,
                      ...(body.focus === undefined ? {} : { focus: body.focus }),
                      ...(body.minutes === undefined ? {} : { minutes: body.minutes }),
                    }
                  : item,
              ),
            },
          },
        };
      });
      response.json({ version: saved.version, schedule: saved.kit.schedule });
    }),
  );

  router.get(
    "/:id/coverage",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const record = await requireReadyKit(dependencies.repositories, owner.id, id);
      const gaps = findGaps(record.kit.role.requirements, record.kit.questions);
      response.json({
        uncovered_requirement_ids: gaps.all,
        must_uncovered_requirement_ids: gaps.must,
        nice_uncovered_requirement_ids: gaps.nice,
        passes: record.kit.coverage.passes,
        history: record.kit.coverage.history ?? [],
      });
    }),
  );

  router.post(
    "/:id/regenerate",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, kitParams);
      const body = parseBody(request, regenerateSchema);
      const record = await requireReadyKit(dependencies.repositories, owner.id, id);
      if (body.section === "schedule") {
        if (record.kit.schedule.edited === true && body.confirm !== true)
          throw new ApiError("VALIDATION_FAILED", "Confirm replacement of the edited schedule.");
        const saved = await mutateOwnedKit(dependencies.repositories, owner.id, id, (latest) => ({
          ...latest,
          kit: {
            ...latest.kit,
            schedule: allocateSchedule({
              requirements: latest.kit.role.requirements,
              questions: latest.kit.questions,
              flashcards: latest.kit.flashcards,
              daysAvailable: latest.kit.schedule.days_available,
            }),
          },
        }));
        response.json({ version: saved.version, schedule: saved.kit.schedule });
        return;
      }
      const key = sectionKey(
        body.section,
        body.section === "questions" ? body.category : undefined,
      );
      if (!(await dependencies.repositories.kits.claimSection(owner.id, id, key)))
        throw new ApiError("SECTION_BUSY", "This section is already regenerating.");
      try {
        const job = await dependencies.repositories.jobs.create({
          ownerId: owner.id,
          kitId: id,
          type: "regenerate",
          section: body.section,
          ...(body.section === "questions" ? { category: body.category } : {}),
          status: "queued",
          steps: [],
          error: null,
        });
        dependencies.jobs.enqueue(job);
        response.status(202).json({ job_id: job.id, kit_id: id });
      } catch (error) {
        await dependencies.repositories.kits.releaseSection(owner.id, id, key);
        throw error;
      }
    }),
  );

  return router;
}
