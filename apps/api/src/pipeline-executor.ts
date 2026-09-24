import {
  InMemoryPipelineStore,
  LlmRateLimiter,
  createDiscussionSearcher,
  createGroqClient,
  createPageFetcher,
  regenerateSection,
  runPipeline,
  systemClock,
} from "@interview-kit/core";

import type { ApiEnvironment } from "./env";
import type { PipelineExecutor } from "./types";

export function createPipelineExecutor(environment: ApiEnvironment): PipelineExecutor {
  const config = environment.pipeline;
  const limiter = new LlmRateLimiter({
    requestsPerMinute: config.llmRpm,
    tokensPerMinute: config.llmTpm,
    clock: systemClock,
  });
  const llm =
    config.groqApiKey === undefined
      ? undefined
      : createGroqClient({
          apiKey: config.groqApiKey,
          limiter,
          clock: systemClock,
          deadlineAt: Number.POSITIVE_INFINITY,
        });
  const fetcher = createPageFetcher({ config, clock: systemClock });
  const discussion = createDiscussionSearcher({ clock: systemClock });
  const common = () => ({
    ...(llm === undefined ? {} : { llm }),
    fetcher,
    store: new InMemoryPipelineStore(),
    discussion,
    clock: systemClock,
    config,
  });
  return {
    create(record, onProgress, signal) {
      return runPipeline(
        { jd: record.input.jd, companyUrl: record.input.companyUrl, days: record.input.days },
        { ...common(), onProgress, signal },
      );
    },
    regenerate(record, job, signal) {
      if (record.kit === null || job.section === undefined)
        return Promise.reject(new Error("Invalid regeneration job."));
      const request =
        job.section === "questions" && job.category !== undefined
          ? { section: "questions" as const, category: job.category }
          : job.section === "company_brief"
            ? { section: "company_brief" as const }
            : { section: "schedule" as const };
      return regenerateSection(record.kit, request, { ...common(), signal });
    },
  };
}
