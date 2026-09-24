import type { Request } from "express";
import type { z } from "zod";

export function parseBody<T>(request: Request, schema: z.ZodType<T>): T {
  return schema.parse(request.body);
}

export function parseParams<T>(request: Request, schema: z.ZodType<T>): T {
  return schema.parse(request.params);
}
