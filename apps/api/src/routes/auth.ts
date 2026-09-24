import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import type { ApiDependencies } from "../dependencies";
import { ApiError, asyncRoute } from "../errors";
import {
  authenticatedUser,
  createSessionToken,
  requireAuthentication,
  sessionCookie,
} from "../middleware/auth";
import { parseBody } from "../middleware/validate";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: z
    .string()
    .min(8)
    .max(72)
    .refine((password) => Buffer.byteLength(password, "utf8") <= 72, "Password is too long."),
});

const dummyHash = bcrypt.hashSync("not-a-real-account-password", 10);

export function authRouter(dependencies: ApiDependencies): Router {
  const router = Router();
  const cookieConfig = {
    secret: dependencies.environment.sessionSecret,
    secure: dependencies.environment.nodeEnv === "production",
  };
  const requireAuth = requireAuthentication(dependencies.repositories, cookieConfig);

  router.post(
    "/register",
    asyncRoute(async (request, response) => {
      const input = parseBody(request, credentialsSchema);
      const passwordHash = await bcrypt.hash(input.password, 10);
      try {
        const user = await dependencies.repositories.users.create(input.email, passwordHash);
        response.cookie(
          sessionCookie.name,
          await createSessionToken(user, cookieConfig),
          sessionCookie.options(cookieConfig.secure),
        );
        response.status(201).json({ id: user.id, email: user.email });
      } catch {
        throw new ApiError("VALIDATION_FAILED", "An account with this email already exists.");
      }
    }),
  );

  router.post(
    "/login",
    asyncRoute(async (request, response) => {
      const input = parseBody(request, credentialsSchema);
      const user = await dependencies.repositories.users.findByEmail(input.email);
      const matches = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
      if (user === null || !matches)
        throw new ApiError("UNAUTHENTICATED", "Invalid email or password.");
      response.cookie(
        sessionCookie.name,
        await createSessionToken(user, cookieConfig),
        sessionCookie.options(cookieConfig.secure),
      );
      response.status(200).json({ id: user.id, email: user.email });
    }),
  );

  router.post(
    "/logout",
    requireAuth,
    asyncRoute(async (request, response) => {
      const user = authenticatedUser(request);
      await dependencies.repositories.users.incrementTokenVersion(user.id);
      response.clearCookie(sessionCookie.name, {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieConfig.secure,
        path: "/",
      });
      response.status(204).end();
    }),
  );

  router.get("/me", requireAuth, (request, response) => {
    const user = authenticatedUser(request);
    response.status(200).json(user);
  });
  return router;
}
