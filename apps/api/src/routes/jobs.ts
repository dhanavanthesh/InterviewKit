import { Router } from "express";
import { z } from "zod";

import type { ApiDependencies } from "../dependencies";
import { ApiError, asyncRoute } from "../errors";
import { authenticatedUser } from "../middleware/auth";
import { parseParams } from "../middleware/validate";

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

function jobResponse(
  job: Awaited<ReturnType<ApiDependencies["repositories"]["jobs"]["findOwned"]>>,
) {
  if (job === null) throw new ApiError("NOT_FOUND", "The job was not found.");
  return { id: job.id, kit_id: job.kitId, status: job.status, steps: job.steps, error: job.error };
}

export function jobsRouter(dependencies: ApiDependencies): Router {
  const router = Router();
  router.get(
    "/:id",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, paramsSchema);
      response.json(jobResponse(await dependencies.repositories.jobs.findOwned(owner.id, id)));
    }),
  );
  router.post(
    "/:id/retry",
    asyncRoute(async (request, response) => {
      const owner = authenticatedUser(request);
      const { id } = parseParams(request, paramsSchema);
      response.status(202).json(jobResponse(await dependencies.jobs.retry(owner.id, id)));
    }),
  );
  return router;
}
