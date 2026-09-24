import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import type { ApiDependencies } from "./dependencies";
import { ApiError, errorBody, errorMiddleware } from "./errors";
import { requireAuthentication } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { builderRouter } from "./routes/builder";
import { jobsRouter } from "./routes/jobs";
import { kitsRouter } from "./routes/kits";
import { practiceRouter } from "./routes/practice";

function limiter(max: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) =>
      response
        .status(429)
        .json(errorBody(new ApiError("RATE_LIMITED", "Too many requests. Try again later."))),
  });
}

export function createApp(dependencies: ApiDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    dependencies.environment.trustProxyHops === 0 ? false : dependencies.environment.trustProxyHops,
  );
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use((request, _response, next) => {
    if (
      dependencies.environment.nodeEnv === "production" &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== undefined &&
      request.headers.origin !== dependencies.environment.webOrigin
    ) {
      next(new ApiError("VALIDATION_FAILED", "The request origin is not permitted."));
      return;
    }
    next();
  });

  app.get("/api/health", (_request, response) => response.json({ ok: true, version: "0.1.0" }));
  app.get("/health", (_request, response) => response.json({ ok: true, version: "0.1.0" }));
  app.use("/api/auth", limiter(20), authRouter(dependencies));

  const requireAuth = requireAuthentication(dependencies.repositories, {
    secret: dependencies.environment.sessionSecret,
    secure: dependencies.environment.nodeEnv === "production",
  });
  const generationLimiter = limiter(10);
  app.post("/api/kits", generationLimiter);
  app.post("/api/kits/batch", generationLimiter);
  app.post("/api/kits/:id/regenerate", generationLimiter);
  app.use("/api/jobs", requireAuth, jobsRouter(dependencies));
  app.use("/api/kits", requireAuth, kitsRouter(dependencies));
  app.use("/api/kits", requireAuth, builderRouter(dependencies));
  app.use("/api/kits", requireAuth, practiceRouter(dependencies));
  app.use((_request, _response, next) =>
    next(new ApiError("NOT_FOUND", "The route was not found.")),
  );
  app.use(errorMiddleware);
  return app;
}
