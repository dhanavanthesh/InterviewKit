import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "NOT_FOUND"
  | "SECTION_BUSY"
  | "VERSION_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "KIT_INVALID"
  | "RATE_LIMITED"
  | "GENERATION_FAILED"
  | "INTERNAL";

const statusByCode: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  NOT_FOUND: 404,
  SECTION_BUSY: 409,
  VERSION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  KIT_INVALID: 422,
  RATE_LIMITED: 429,
  GENERATION_FAILED: 500,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorBody(error: ApiError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response, next).catch(next);
  };
}

export function errorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  void _next;
  if (error instanceof ApiError) {
    response.status(statusByCode[error.code]).json(errorBody(error));
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json(
      errorBody(
        new ApiError("VALIDATION_FAILED", "The request is invalid.", {
          fields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        }),
      ),
    );
    return;
  }
  if (error instanceof multer.MulterError) {
    const code = error.code === "LIMIT_FILE_SIZE" ? "PAYLOAD_TOO_LARGE" : "VALIDATION_FAILED";
    response
      .status(code === "PAYLOAD_TOO_LARGE" ? 413 : 400)
      .json(
        errorBody(
          new ApiError(
            code,
            code === "PAYLOAD_TOO_LARGE" ? "The upload is too large." : "The upload is invalid.",
          ),
        ),
      );
    return;
  }
  const isTooLarge =
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large";
  if (isTooLarge) {
    response
      .status(413)
      .json(errorBody(new ApiError("PAYLOAD_TOO_LARGE", "The request is too large.")));
    return;
  }
  const isInvalidJson =
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed";
  if (isInvalidJson) {
    response
      .status(400)
      .json(errorBody(new ApiError("VALIDATION_FAILED", "The JSON body is invalid.")));
    return;
  }
  response
    .status(500)
    .json(errorBody(new ApiError("INTERNAL", "The request could not be completed.")));
}
