import { allocateSchedule, findGaps } from "@interview-kit/logic";
import type { Kit } from "@interview-kit/schema";
import type { Express } from "express";
import request from "supertest";

import { createApp } from "../src/app";
import { parseApiEnvironment } from "../src/env";
import { InMemoryRepositories } from "../src/repositories/repository";
import { JobRunner } from "../src/services/job-runner";
import type { JobRecord, KitRecord, PipelineExecutor } from "../src/types";

export function makeKit(days = 5): Kit {
  const requirements = [
    {
      id: "r1",
      text: "Build TypeScript services",
      kind: "technical" as const,
      priority: "must" as const,
      origin: "generated" as const,
    },
    {
      id: "r2",
      text: "Communicate with product partners",
      kind: "behavioural" as const,
      priority: "nice" as const,
      origin: "generated" as const,
    },
  ];
  const questions = [
    {
      id: "q1",
      requirement_ids: ["r1"],
      category: "technical" as const,
      prompt: "How would you build a TypeScript service?",
      answer_outline: "Discuss boundaries and tests.",
      difficulty: 2,
      origin: "generated" as const,
      edited: false,
      pinned: false,
      generated_by: "draft" as const,
    },
    {
      id: "q2",
      requirement_ids: ["r2"],
      category: "behavioural" as const,
      prompt: "Tell me about product collaboration.",
      answer_outline: "Use a clear STAR example.",
      difficulty: 1,
      origin: "generated" as const,
      edited: false,
      pinned: false,
      generated_by: "draft" as const,
    },
  ];
  const flashcards = questions.map((question, index) => ({
    id: `f${index + 1}`,
    front: question.prompt,
    back: question.answer_outline,
    requirement_ids: question.requirement_ids,
    question_id: question.id,
    origin: "generated" as const,
    edited: false,
    pinned: false,
    generated_by: "draft" as const,
  }));
  const schedule = allocateSchedule({ requirements, questions, flashcards, daysAvailable: days });
  return {
    source: {
      company: "Example",
      company_url: "https://example.com",
      role: "Engineer",
      location: "Remote",
      jd_chars: 42,
      researched_at: "2026-09-24T00:00:00Z",
      pages_used: ["https://example.com"],
    },
    company_brief: {
      summary: "Example builds developer tools.",
      what_they_do: "Developer tooling.",
      sources: ["https://example.com"],
    },
    role: {
      title: "Engineer",
      seniority: "Senior",
      responsibilities: ["Build services"],
      requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: findGaps(requirements, questions).all, passes: 1 },
  };
}

export class FixtureExecutor implements PipelineExecutor {
  readonly createCalls: KitRecord[] = [];
  failCreate = false;
  failRegenerate = false;
  createGate?: Promise<void>;
  regenerateGate?: Promise<void>;

  async create(
    record: KitRecord,
    onProgress: Parameters<PipelineExecutor["create"]>[1],
  ): Promise<Kit> {
    this.createCalls.push(structuredClone(record));
    await this.createGate;
    await onProgress({
      step: "validate",
      status: "done",
      message: "Input valid",
      at: new Date().toISOString(),
    });
    await onProgress({
      step: "save/write",
      status: "done",
      message: "Kit ready",
      at: new Date().toISOString(),
    });
    if (this.failCreate) throw new Error("fixture failure with hidden details");
    return makeKit(record.input.days);
  }

  async regenerate(record: KitRecord, job: JobRecord): Promise<Kit> {
    await this.regenerateGate;
    if (this.failRegenerate) throw new Error("regeneration fixture failure");
    const current = structuredClone(record.kit ?? makeKit(record.input.days));
    if (job.section === "company_brief") {
      current.company_brief = {
        summary: "Regenerated company brief.",
        what_they_do: "Updated supported work.",
        sources: ["https://example.com"],
      };
    }
    if (job.section === "questions" && job.category !== undefined) {
      current.questions = current.questions.filter(({ category }) => category !== job.category);
      current.questions.push({
        id: "q900",
        requirement_ids: ["r1"],
        category: job.category,
        prompt: "Regenerated TypeScript service trade-offs",
        answer_outline: "Explain production choices.",
        difficulty: 3,
        origin: "generated",
        edited: false,
        pinned: false,
        generated_by: "draft",
      });
    }
    current.schedule = allocateSchedule({
      requirements: current.role.requirements,
      questions: current.questions,
      flashcards: current.flashcards,
      daysAvailable: current.schedule.days_available,
    });
    return current;
  }
}

export function testContext(
  options: {
    production?: boolean;
    executor?: FixtureExecutor;
    validateUrl?: (value: string) => Promise<void>;
  } = {},
) {
  const repositories = new InMemoryRepositories();
  const executor = options.executor ?? new FixtureExecutor();
  const environment = parseApiEnvironment({
    NODE_ENV: options.production ? "production" : "test",
    MONGODB_URI: "mongodb://example.invalid/test",
    SESSION_SECRET: "a-secure-test-session-secret-over-thirty-two-bytes",
    WEB_ORIGIN: "https://web.example.com",
    ALLOW_PRIVATE_HOSTS: "false",
  });
  const jobs = new JobRunner(repositories, executor, 2);
  const app = createApp({
    repositories,
    jobs,
    environment,
    validateCompanyUrl:
      options.validateUrl ??
      ((value) => {
        new URL(value);
        return Promise.resolve();
      }),
  });
  return { app, repositories, executor, jobs };
}

export async function registerAgent(app: Express, email = "user@example.com") {
  const agent = request.agent(app);
  const result = await agent
    .post("/api/auth/register")
    .send({ email, password: "secure-password" });
  if (result.status !== 201) throw new Error(`Registration failed: ${result.status}`);
  return agent;
}

export async function createReadyKit(
  context: ReturnType<typeof testContext>,
  agent: ReturnType<typeof request.agent>,
  days = 5,
) {
  const created = await agent.post("/api/kits").send({
    jd: "Requirements\n- Build TypeScript services",
    company_url: "https://example.com",
    days,
  });
  await context.jobs.drain();
  const detail = await agent.get(`/api/kits/${created.body.kit_id as string}`);
  return {
    created,
    detail,
    kitId: created.body.kit_id as string,
    jobId: created.body.job_id as string,
  };
}
