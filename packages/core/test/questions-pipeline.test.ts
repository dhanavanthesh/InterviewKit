import { checkKitReferences, findGaps } from "@interview-kit/logic";
import { kitSchema, type Requirement } from "@interview-kit/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startFixtureServer } from "../../../fixtures/sites/server";
import { systemClock } from "../src/clock";
import { parseConfig } from "../src/config";
import { createDiscussionSearcher } from "../src/discussion";
import { createPageFetcher } from "../src/fetcher";
import { KitTokenBudget } from "../src/limiter";
import { FixtureLlmClient } from "../src/llm";
import { runPipeline } from "../src/pipeline";
import {
  generateCoveredQuestions,
  generateFlashcards,
  planQuestionCategories,
  validateQuestionDrafts,
} from "../src/questions";
import { InMemoryPipelineStore } from "../src/store";
import type { DiscussionSearcher, LlmRequest } from "../src/types";

const requirements: Requirement[] = [
  {
    id: "r1",
    text: "TypeScript services",
    kind: "technical",
    priority: "must",
    evidence: "Must have experience building TypeScript services.",
  },
  {
    id: "r2",
    text: "mentor engineers",
    kind: "behavioural",
    priority: "must",
    evidence: "You will mentor engineers.",
  },
];

describe("category planning and link validation", () => {
  it("keeps behavioural requirements out of technical groups", () => {
    const groups = planQuestionCategories({
      requirements,
      seniority: "Senior",
      hiringText: "System design round",
      hasCompanyBrief: true,
    });
    expect(
      groups
        .filter(({ category }) => category === "technical")
        .flatMap(({ requirements }) => requirements),
    ).toEqual([requirements[0]]);
    expect(groups.some(({ category }) => category === "system-design")).toBe(true);
    expect(groups.some(({ category }) => category === "company-fit")).toBe(true);
  });

  it("does not invent system-design for a junior role without hiring evidence", () => {
    const groups = planQuestionCategories({
      requirements: [requirements[0]!],
      seniority: "Junior",
      hiringText: "",
      hasCompanyBrief: false,
    });
    expect(groups.map(({ category }) => category)).toEqual(["technical"]);
  });

  it("removes foreign IDs, caps links, and drops questions without overlap", () => {
    const questions = validateQuestionDrafts({
      drafts: [
        {
          requirement_ids: ["r1", "foreign", "r1"],
          prompt: "How did you design TypeScript services?",
          answer_outline: "Discuss TypeScript trade-offs.",
          difficulty: 8,
        },
        {
          requirement_ids: ["r1"],
          prompt: "What is your favorite color?",
          answer_outline: "Blue.",
          difficulty: 1,
        },
      ],
      category: "technical",
      allowedRequirements: requirements,
      startNumber: 1,
      generatedBy: "draft",
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      requirement_ids: ["r1"],
      difficulty: 3,
      category: "technical",
    });
  });
});

describe("coverage generation", () => {
  const config = parseConfig({ LLM_MAX_PASSES: "2", LLM_KIT_TOKEN_BUDGET: "10000" });

  it("sends only uncovered requirements to a gap call", async () => {
    let questionCall = 0;
    const llm = new FixtureLlmClient((request) => {
      if (!request.schemaName.endsWith("questions")) return { questions: [] };
      questionCall += 1;
      const data = request.data as { requirements: Requirement[] };
      const selected = questionCall === 1 ? data.requirements.slice(0, 1) : data.requirements;
      return {
        questions: selected.map((requirement) => ({
          requirement_ids: [requirement.id],
          prompt: `Explain ${requirement.text} in practice.`,
          answer_outline: `Discuss ${requirement.text}.`,
          difficulty: 2,
        })),
      };
    });
    const result = await generateCoveredQuestions({
      requirements,
      groups: [{ category: "technical", requirements }],
      llm,
      config,
      budget: new KitTokenBudget(10_000),
      hiringText: "",
      companyContext: "",
    });
    const gapCall = llm.calls.find(({ category }) => category === "gap")!;
    expect(
      (gapCall.data as { requirements: Requirement[] }).requirements.map(({ id }) => id),
    ).toEqual(["r2"]);
    expect(findGaps(requirements, result.questions).must).toEqual([]);
  });

  it("uses deterministic fallbacks after model failures", async () => {
    const llm = new FixtureLlmClient(() => new Error("unavailable"));
    const result = await generateCoveredQuestions({
      requirements,
      groups: [{ category: "technical", requirements }],
      llm,
      config,
      budget: new KitTokenBudget(10_000),
      hiringText: "",
      companyContext: "",
    });
    expect(findGaps(requirements, result.questions).all).toEqual([]);
    expect(result.questions.every(({ generated_by }) => generated_by === "fallback")).toBe(true);
  });

  it("never returns a flashcard with a blank side", async () => {
    const llm = new FixtureLlmClient(() => ({
      flashcards: [{ question_id: "q1", requirement_ids: ["r1"], front: "  ", back: "" }],
    }));
    const cards = await generateFlashcards({
      questions: [
        {
          id: "q1",
          requirement_ids: ["r1"],
          category: "technical",
          prompt: "How would you design a TypeScript service?",
          answer_outline: "Cover boundaries, testing and observability.",
          difficulty: 2,
        },
      ],
      llm,
      config,
      budget: new KitTokenBudget(10_000),
    });
    expect(cards[0]).toMatchObject({
      front: "How would you design a TypeScript service?",
      back: "Cover boundaries, testing and observability.",
    });
  });

  it("keeps zero requirements honest", async () => {
    const result = await generateCoveredQuestions({
      requirements: [],
      groups: [],
      config,
      budget: new KitTokenBudget(10_000),
      hiringText: "",
      companyContext: "",
    });
    expect(result).toEqual({ questions: [], passes: 0, history: [], degraded: false });
  });
});

let origin: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const fixture = await startFixtureServer();
  origin = fixture.origin;
  close = fixture.close;
});

afterAll(async () => close());

function fixtureResponder(request: LlmRequest<unknown>): unknown {
  if (request.schemaName === "job_extraction") {
    return {
      company_name: "",
      title: "Staff Platform Engineer",
      title_evidence: "Staff Platform Engineer",
      seniority: "Staff",
      seniority_evidence: "Staff Platform Engineer",
      location: "",
      location_evidence: "",
      responsibilities: [],
      requirements: [
        {
          text: "designing distributed TypeScript services",
          kind: "technical",
          priority: "must",
          evidence: "Must have experience designing distributed TypeScript services.",
        },
        {
          text: "ownership and communication skills",
          kind: "behavioural",
          priority: "must",
          evidence: "Strong ownership and communication skills are required.",
        },
      ],
    };
  }
  if (request.schemaName === "hiring_process") {
    const pages = request.data as Array<{ url: string }>;
    return {
      stages: ["Recruiter conversation", "Take-home exercise", "System-design round"],
      notes: "The process includes a take-home exercise and system-design round.",
      sources: [pages[0]!.url, "https://foreign.example/process"],
    };
  }
  if (request.schemaName === "company_brief") {
    const pages = request.data as Array<{ url: string }>;
    return {
      summary: "Signal Forge builds observability tools.",
      what_they_do: "It builds observability tools for distributed services.",
      sources: [pages[0]!.url, "https://foreign.example/about"],
    };
  }
  if (request.schemaName.endsWith("questions")) {
    const data = request.data as { requirements: Requirement[]; category: string };
    return {
      questions: data.requirements.map((requirement) => ({
        requirement_ids: [requirement.id, "foreign"],
        prompt: `How would you demonstrate ${requirement.text} in this ${data.category} interview?`,
        answer_outline: `Explain ${requirement.text}, constraints, trade-offs, and outcomes.`,
        difficulty: data.category === "system-design" ? 3 : 2,
      })),
    };
  }
  if (request.schemaName === "flashcards") {
    const questions = request.data as Array<{
      id: string;
      requirement_ids: string[];
      prompt: string;
      answer_outline: string;
    }>;
    return {
      flashcards: questions.map((question) => ({
        question_id: question.id,
        requirement_ids: question.requirement_ids,
        front: question.prompt,
        back: question.answer_outline,
      })),
    };
  }
  return { summary: "", sources: [] };
}

describe("shared pipeline", () => {
  it("produces a valid take-home kit with separate system-design generation", async () => {
    const config = parseConfig({
      ALLOW_PRIVATE_HOSTS: "true",
      CRAWL_TIMEOUT_MS: "1000",
      RESEARCH_TIMEOUT_MS: "5000",
      LLM_TPM: "50000",
    });
    const llm = new FixtureLlmClient(fixtureResponder);
    const discussion: DiscussionSearcher = {
      search: () => Promise.resolve({ hits: [], failed: false }),
    };
    const kit = await runPipeline(
      {
        jd: "Staff Platform Engineer\nRequirements\n- Must have experience designing distributed TypeScript services.\n- Strong ownership and communication skills are required.",
        companyUrl: `${origin}/take-home/`,
        days: 7,
      },
      {
        llm,
        fetcher: createPageFetcher({ config, clock: systemClock, random: () => 0 }),
        store: new InMemoryPipelineStore(),
        discussion,
        clock: systemClock,
        config,
      },
    );
    expect(kitSchema.safeParse(kit).success).toBe(true);
    expect(checkKitReferences(kit)).toEqual([]);
    expect(kit.schedule.days).toHaveLength(7);
    expect(findGaps(kit.role.requirements, kit.questions).must).toEqual([]);
    expect(kit.hiring_process?.stages).toContain("System-design round");
    expect(kit.questions.some(({ category }) => category === "system-design")).toBe(true);
    expect(llm.calls.some(({ category }) => category === "behavioural")).toBe(true);
    const technicalCalls = llm.calls.filter(({ category }) => category === "technical");
    expect(
      technicalCalls
        .flatMap((call) => (call.data as { requirements: Requirement[] }).requirements)
        .some(({ kind }) => kind === "behavioural"),
    ).toBe(false);
    expect(kit.company_brief.sources).not.toContain("https://foreign.example/about");
  });

  it("skips research for a malformed URL and still returns an honest kit", async () => {
    const config = parseConfig({ ALLOW_PRIVATE_HOSTS: "true" });
    let fetched = false;
    const kit = await runPipeline(
      {
        jd: "Backend Engineer\nRequirements\n- Must have production PostgreSQL experience.",
        companyUrl: "http://%",
        days: 3,
      },
      {
        fetcher: {
          fetch: () => {
            fetched = true;
            return Promise.reject(new Error("fetch must not be attempted"));
          },
        },
        store: new InMemoryPipelineStore(),
        discussion: createDiscussionSearcher({
          clock: systemClock,
          request: () => Promise.reject(new Error("no network in tests")),
        }),
        clock: systemClock,
        config,
      },
    );
    expect(fetched).toBe(false);
    expect(kitSchema.safeParse(kit).success).toBe(true);
    expect(kit.source.company_url).toBe("http://%");
    expect(kit.company_brief.sources).toEqual([]);
    expect(kit.warnings?.map(({ code }) => code)).toContain("COMPANY_UNREACHABLE");
    expect(kit.role.requirements).toHaveLength(1);
    expect(findGaps(kit.role.requirements, kit.questions).must).toEqual([]);
    expect(kit.schedule.days).toHaveLength(3);
  });

  it("produces an honest zero-requirement kit without an LLM", async () => {
    const config = parseConfig({
      ALLOW_PRIVATE_HOSTS: "true",
      CRAWL_TIMEOUT_MS: "1000",
      RESEARCH_TIMEOUT_MS: "5000",
    });
    const kit = await runPipeline(
      {
        jd: "Software Engineer\nJoin our growing team.",
        companyUrl: `${origin}/no-hiring/`,
        days: 60,
      },
      {
        fetcher: createPageFetcher({ config, clock: systemClock }),
        store: new InMemoryPipelineStore(),
        discussion: { search: () => Promise.resolve({ hits: [], failed: false }) },
        clock: systemClock,
        config,
      },
    );
    expect(kit.role.requirements).toEqual([]);
    expect(kit.questions).toEqual([]);
    expect(kit.flashcards).toEqual([]);
    expect(kit.schedule.days).toHaveLength(60);
    expect(kit.hiring_process).toBeNull();
    expect(kit.warnings?.map(({ code }) => code)).toContain("NO_EXPLICIT_REQUIREMENTS");
  });
});
