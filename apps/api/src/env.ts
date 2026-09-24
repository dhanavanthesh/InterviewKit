import path from "node:path";

import { parseConfig, type ConfigEnvironment, type PipelineConfig } from "@interview-kit/core";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { ApiError } from "./errors";

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  MONGODB_URI: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  SESSION_SECRET: z.preprocess(blankToUndefined, z.string().min(32).max(512).optional()),
  WEB_ORIGIN: z.preprocess(blankToUndefined, z.string().url().optional()),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  API_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
});

export interface ApiEnvironment {
  nodeEnv: "development" | "test" | "production";
  port: number;
  mongoUri: string;
  sessionSecret: string;
  webOrigin: string;
  trustProxyHops: number;
  jobConcurrency: number;
  pipeline: PipelineConfig;
}

export function parseApiEnvironment(
  values: ConfigEnvironment,
  options: { requireExternalServices?: boolean } = {},
): ApiEnvironment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new ApiError("VALIDATION_FAILED", `Invalid environment variables: ${names.join(", ")}.`);
  }
  const value = result.data;
  const required = options.requireExternalServices ?? value.NODE_ENV === "production";
  const missing = [
    ...(value.MONGODB_URI === undefined && required ? ["MONGODB_URI"] : []),
    ...(value.SESSION_SECRET === undefined && required ? ["SESSION_SECRET"] : []),
    ...(value.WEB_ORIGIN === undefined && required ? ["WEB_ORIGIN"] : []),
  ];
  if (missing.length > 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Missing environment variables: ${missing.join(", ")}.`,
    );
  }
  const pipeline = parseConfig(values);
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    mongoUri: value.MONGODB_URI ?? "",
    sessionSecret: value.SESSION_SECRET ?? "test-session-secret-that-is-at-least-32-bytes",
    webOrigin: value.WEB_ORIGIN ?? "http://localhost:3000",
    trustProxyHops: value.TRUST_PROXY_HOPS,
    jobConcurrency: value.API_JOB_CONCURRENCY,
    pipeline: {
      ...pipeline,
      allowPrivateHosts: value.NODE_ENV === "production" ? false : pipeline.allowPrivateHosts,
    },
  };
}

export function loadApiEnvironment(root = process.cwd()): ApiEnvironment {
  loadDotEnv({ path: path.join(root, ".env"), override: false, quiet: true });
  return parseApiEnvironment(process.env, { requireExternalServices: true });
}
