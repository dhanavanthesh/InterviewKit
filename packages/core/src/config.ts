import path from "node:path";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { PipelineError } from "./errors";
import type { PipelineConfig } from "./types";

const positiveInteger = z.coerce.number().int().positive();
const configSchema = z.object({
  // A blank key copied from the template means "no key", not an invalid configuration.
  GROQ_API_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().min(1).optional(),
  ),
  GROQ_MODEL_MAIN: z.string().min(1).default("openai/gpt-oss-120b"),
  GROQ_MODEL_LIGHT: z.string().min(1).default("openai/gpt-oss-20b"),
  LLM_RPM: positiveInteger.default(30),
  LLM_TPM: positiveInteger.default(8000),
  LLM_KIT_TOKEN_BUDGET: positiveInteger.default(20_000),
  LLM_MAX_PASSES: positiveInteger.default(3),
  ALLOW_PRIVATE_HOSTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CRAWL_MAX_PAGES: positiveInteger.default(10),
  CRAWL_TIMEOUT_MS: positiveInteger.default(8000),
  CRAWL_MAX_BYTES: positiveInteger.default(2_097_152),
  RESEARCH_TIMEOUT_MS: positiveInteger.default(45_000),
  CRAWL_USER_AGENT: z.string().min(1).default("InterviewPrepKitBot/1.0"),
  EVAL_CONCURRENCY: positiveInteger.default(2),
  EVAL_RUN_DEADLINE_MS: positiveInteger.default(780_000),
});

export type ConfigEnvironment = Record<string, string | undefined>;

export function parseConfig(environment: ConfigEnvironment): PipelineConfig {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    throw new PipelineError(
      "INVALID_CONFIG",
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}.`,
    );
  }
  const value = result.data;
  return {
    ...(value.GROQ_API_KEY === undefined ? {} : { groqApiKey: value.GROQ_API_KEY }),
    mainModel: value.GROQ_MODEL_MAIN,
    lightModel: value.GROQ_MODEL_LIGHT,
    llmRpm: value.LLM_RPM,
    llmTpm: value.LLM_TPM,
    kitTokenBudget: value.LLM_KIT_TOKEN_BUDGET,
    maxCoveragePasses: value.LLM_MAX_PASSES,
    allowPrivateHosts: value.ALLOW_PRIVATE_HOSTS,
    crawlMaxPages: value.CRAWL_MAX_PAGES,
    crawlTimeoutMs: value.CRAWL_TIMEOUT_MS,
    crawlMaxBytes: value.CRAWL_MAX_BYTES,
    researchTimeoutMs: value.RESEARCH_TIMEOUT_MS,
    crawlUserAgent: value.CRAWL_USER_AGENT,
    evalConcurrency: value.EVAL_CONCURRENCY,
    evalRunDeadlineMs: value.EVAL_RUN_DEADLINE_MS,
  };
}

export function loadConfig(rootDirectory = process.cwd()): PipelineConfig {
  loadDotEnv({ path: path.join(rootDirectory, ".env"), override: false, quiet: true });
  return parseConfig(process.env);
}
