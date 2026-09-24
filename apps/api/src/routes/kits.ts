import { Router } from "express";
import multer from "multer";
import { createKitRequestSchema } from "@interview-kit/schema";
import { z } from "zod";

import type { ApiDependencies } from "../dependencies";
import { ApiError, asyncRoute } from "../errors";
import { authenticatedUser } from "../middleware/auth";
import { parseBody, parseParams } from "../middleware/validate";
import { createKit } from "../services/kit-creation";

const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_048_576, files: 1 },
});
const batchRowSchema = createKitRequestSchema
  .omit({ force: true })
  .extend({ days: z.number().int().min(1).max(365).optional() });

function creationBody(result: Awaited<ReturnType<typeof createKit>>) {
  return {
    kit_id: result.kit.id,
    job_id: result.job?.id ?? null,
    status: result.kit.status,
    existing: result.existing,
  };
}

async function validateUrl(dependencies: ApiDependencies, value: string): Promise<void> {
  try {
    await dependencies.validateCompanyUrl(value);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "The company URL is invalid or unsafe.");
  }
}

export function kitsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const parsed = parseBody(request, createKitRequestSchema);
      await validateUrl(dependencies, parsed.company_url);
      const result = await createKit(dependencies.repositories, dependencies.jobs, owner.id, {
        jd: parsed.jd,
        companyUrl: parsed.company_url,
        days: parsed.days,
        force: parsed.force ?? false,
      });
      response.status(result.existing ? 200 : 202).json(creationBody(result));
    }),
  );

  router.post(
    "/batch",
    upload.single("file"),
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      if (request.file === undefined)
        throw new ApiError("VALIDATION_FAILED", "A JSON file is required.");
      if (
        request.file.mimetype !== "application/json" ||
        !request.file.originalname.toLowerCase().endsWith(".json")
      ) {
        throw new ApiError("VALIDATION_FAILED", "The upload must be a JSON file.");
      }
      let rows: unknown;
      try {
        rows = JSON.parse(request.file.buffer.toString("utf8")) as unknown;
      } catch {
        throw new ApiError("VALIDATION_FAILED", "The upload is not valid JSON.");
      }
      if (!Array.isArray(rows))
        throw new ApiError("VALIDATION_FAILED", "The upload must contain an array.");
      if (rows.length > 50)
        throw new ApiError("VALIDATION_FAILED", "The upload may contain at most 50 rows.");
      const form = z
        .object({ default_days: z.string().optional() })
        .passthrough()
        .parse(request.body as unknown);
      const defaultDays = form.default_days === undefined ? undefined : Number(form.default_days);
      if (
        defaultDays !== undefined &&
        (!Number.isInteger(defaultDays) || defaultDays < 1 || defaultDays > 365)
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "default_days must be an integer from 1 through 365.",
        );
      }
      const results = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as unknown;
        let candidate: unknown = row;
        if (typeof row === "object" && row !== null) {
          const record = { ...(row as Record<string, unknown>) };
          if (!("days" in record) && defaultDays !== undefined) record.days = defaultDays;
          candidate = record;
        }
        const parsed = batchRowSchema.safeParse(candidate);
        if (!parsed.success || parsed.data.days === undefined) {
          results.push({
            row: index,
            kit_id: null,
            job_id: null,
            error: { code: "VALIDATION_FAILED", message: "The row is invalid." },
          });
          continue;
        }
        try {
          await validateUrl(dependencies, parsed.data.company_url);
          const created = await createKit(dependencies.repositories, dependencies.jobs, owner.id, {
            jd: parsed.data.jd,
            companyUrl: parsed.data.company_url,
            days: parsed.data.days,
            force: false,
          });
          results.push({
            row: index,
            kit_id: created.kit.id,
            job_id: created.job?.id ?? null,
            error: null,
          });
        } catch {
          results.push({
            row: index,
            kit_id: null,
            job_id: null,
            error: { code: "VALIDATION_FAILED", message: "The row URL is invalid or unsafe." },
          });
        }
      }
      response.status(202).json(results);
    }),
  );

  router.get(
    "/",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50) || 50));
      const records = await dependencies.repositories.kits.listOwned(owner.id, limit);
      response.json(
        records.map((record) => ({
          id: record.id,
          company: record.kit?.source.company ?? "",
          role: record.kit?.role.title ?? "",
          status: record.status,
          days: record.input.days,
          updated_at: record.updatedAt.toISOString(),
        })),
      );
    }),
  );

  router.get(
    "/:id",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, idParamsSchema);
      const record = await dependencies.repositories.kits.findOwned(owner.id, id);
      if (record === null) throw new ApiError("NOT_FOUND", "The kit was not found.");
      response.json({
        id: record.id,
        status: record.status,
        version: record.version,
        kit: record.kit,
      });
    }),
  );

  router.delete(
    "/:id",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, idParamsSchema);
      const deleted = await dependencies.repositories.kits.deleteOwned(owner.id, id);
      if (!deleted) throw new ApiError("NOT_FOUND", "The kit was not found.");
      dependencies.jobs.cancelKit(id);
      await dependencies.repositories.jobs.deleteForKit(owner.id, id);
      await dependencies.repositories.reviews.deleteForKit(owner.id, id);
      response.status(204).end();
    }),
  );
  return router;
}
