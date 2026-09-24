import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";

import { ApiError } from "../errors";
import type { Repositories } from "../repositories/repository";
import type { AuthenticatedUser, UserRecord } from "../types";

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthenticatedUser;
  }
}

const encoder = new TextEncoder();

export interface SessionConfig {
  secret: string;
  secure: boolean;
}

export async function createSessionToken(user: UserRecord, config: SessionConfig): Promise<string> {
  return new SignJWT({ token_version: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encoder.encode(config.secret));
}

export const sessionCookie = {
  name: "sid",
  options(secure: boolean) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  },
};

export function requireAuthentication(repositories: Repositories, config: SessionConfig) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    const token = request.cookies[sessionCookie.name] as unknown;
    if (typeof token !== "string" || token.length === 0) {
      next(new ApiError("UNAUTHENTICATED", "Authentication is required."));
      return;
    }
    try {
      const verified = await jwtVerify(token, encoder.encode(config.secret), {
        algorithms: ["HS256"],
      });
      const subject = verified.payload.sub;
      const tokenVersion = verified.payload.token_version;
      if (typeof subject !== "string" || typeof tokenVersion !== "number")
        throw new Error("invalid session");
      const user = await repositories.users.findById(subject);
      if (user === null || user.tokenVersion !== tokenVersion) throw new Error("revoked session");
      request.authUser = { id: user.id, email: user.email };
      next();
    } catch {
      next(new ApiError("SESSION_EXPIRED", "The session is invalid or expired."));
    }
  };
}

export function authenticatedUser(request: Request): AuthenticatedUser {
  if (request.authUser === undefined)
    throw new ApiError("UNAUTHENTICATED", "Authentication is required.");
  return request.authUser;
}
