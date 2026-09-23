import { allocateSchedule, findGaps } from "@interview-kit/logic";
import type { Kit, ProgressEvent, Warning } from "@interview-kit/schema";

import { repairKit, validateKit } from "./assembly";
import { crawlCompanySite } from "./crawler";
import { PipelineError } from "./errors";
import { extractRoleAndRequirements } from "./extraction";
import { KitTokenBudget } from "./limiter";
import { generateCoveredQuestions, generateFlashcards, planQuestionCategories } from "./questions";
import { generateResearch } from "./research-generation";
import { safeHostname } from "./url-safety";
import type {
  CrawlResult,
  LlmClient,
  LlmUsage,
  PipelineDependencies,
  PipelineInput,
  PipelineResult,
} from "./types";

function dedupeWarnings(warnings: readonly Warning[]): Warning[] {
  const byCode = new Map<Warning["code"], Warning>();
  for (const warning of warnings) if (!byCode.has(warning.code)) byCode.set(warning.code, warning);
  return [...byCode.values()];
}

function isoWithoutMilliseconds(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function emptyCrawl(companyUrl: string, warning: Warning): CrawlResult {
  const companyName = safeHostname(companyUrl)?.split(".")[0] ?? "";
  return {
    pages: [],
    log: [{ url: companyUrl, status: "failed", reason: warning.message }],
    companyName,
    warnings: [warning],
  };
}

function meteredLlm(client: LlmClient | undefined, usage: LlmUsage): LlmClient | undefined {
  if (client === undefined) return undefined;
  return {
    async complete(request) {
      const response = await client.complete(request);
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.totalTokens += response.usage.totalTokens;
      return response;
    },
  };
}

export async function runPipelineWithMetrics(
  input: PipelineInput,
  dependencies: PipelineDependencies,
): Promise<PipelineResult> {
  const started = dependencies.clock.now();
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const llm = meteredLlm(dependencies.llm, usage);
  const budget = new KitTokenBudget(dependencies.config.kitTokenBudget);
  const emit = async (
    step: string,
    status: ProgressEvent["status"],
    message: string,
  ): Promise<void> => {
    await dependencies.onProgress?.({
      step,
      status,
      message,
      at: new Date(dependencies.clock.now()).toISOString(),
    });
  };

  await emit("validate", "running", "Validating input");
  if (input.jd.trim().length === 0)
    throw new PipelineError("EMPTY_JD", "The job description is blank.");
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new PipelineError("INVALID_INPUT", "Days must be a positive integer.");
  }
  await emit("validate", "done", "Input is valid");
  await emit("extract_requirements", "running", "Extracting role requirements");
  await emit("check_url", "running", "Checking the company URL");
  const extractionPromise = extractRoleAndRequirements({
    jd: input.jd,
    ...(llm === undefined ? {} : { llm }),
    config: dependencies.config,
    budget,
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
  const unreachable: Warning = {
    code: "COMPANY_UNREACHABLE",
    message: "The company site could not be retrieved safely.",
  };
  const crawlPromise =
    safeHostname(input.companyUrl) === undefined
      ? Promise.resolve(
          emptyCrawl(input.companyUrl, {
            ...unreachable,
            message: "The company URL is malformed, so research was skipped.",
          }),
        )
      : crawlCompanySite(
          input.companyUrl,
          { fetcher: dependencies.fetcher, config: dependencies.config, clock: dependencies.clock },
          dependencies.signal,
        ).catch(() => emptyCrawl(input.companyUrl, unreachable));
  const [role, crawl] = await Promise.all([extractionPromise, crawlPromise]);
  await emit("extract_requirements", "done", `Grounded ${role.requirements.length} requirements`);
  await emit(
    "ground_requirements",
    "done",
    "Requirement evidence and priority were validated in code",
  );
  await emit(
    "check_url",
    crawl.pages.length > 0 ? "done" : "failed",
    crawl.pages.length > 0 ? "Company URL is reachable" : "Company research is unavailable",
  );
  await emit(
    "fetch_homepage",
    crawl.pages.length > 0 ? "done" : "failed",
    crawl.pages.length > 0 ? "Homepage retrieval completed" : "No homepage was retrieved",
  );
  await emit("crawl_site", "done", `Retrieved ${crawl.pages.length} company pages`);

  const companyName = crawl.companyName || role.companyNameHint || "";
  await emit("public_discussion", "running", "Searching public interview discussion");
  const discussionResult = await dependencies.discussion.search(
    companyName,
    input.companyUrl,
    dependencies.signal,
  );
  await emit(
    "public_discussion",
    discussionResult.failed ? "failed" : "done",
    discussionResult.failed
      ? "Public discussion search was unavailable"
      : `Found ${discussionResult.hits.length} relevant public results`,
  );
  await emit("hiring_process", "running", "Extracting supported hiring stages");
  await emit("company_brief", "running", "Building a sourced company brief");
  const research = await generateResearch({
    crawl,
    discussionResult,
    companyUrl: input.companyUrl,
    ...(llm === undefined ? {} : { llm }),
    config: dependencies.config,
    budget,
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
  await emit(
    "hiring_process",
    research.hiringProcess === null ? "skipped" : "done",
    research.hiringProcess === null
      ? "No supported hiring process was found"
      : "Hiring stages were grounded to retrieved pages",
  );
  await emit("company_brief", "done", "Company brief completed");

  const hiringText =
    research.hiringProcess === null
      ? ""
      : `${research.hiringProcess.stages.join(" ")} ${research.hiringProcess.notes}`;
  await emit("plan_categories", "running", "Planning requirement-specific categories");
  const groups = planQuestionCategories({
    requirements: role.requirements,
    seniority: role.seniority,
    hiringText,
    hasCompanyBrief: research.companyBrief.sources.length > 0,
  });
  await emit("plan_categories", "done", `Planned ${groups.length} category groups`);
  for (const group of groups)
    await emit(`questions:${group.category}`, "running", `Generating ${group.category} questions`);
  const generated = await generateCoveredQuestions({
    requirements: role.requirements,
    groups,
    ...(llm === undefined ? {} : { llm }),
    config: dependencies.config,
    budget,
    hiringText,
    companyContext: `${research.companyBrief.summary} ${research.companyBrief.what_they_do}`,
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
  for (const group of groups)
    await emit(`questions:${group.category}`, "done", `${group.category} generation completed`);
  generated.history.forEach(({ pass, uncovered_ids }) => {
    void emit(
      `coverage_pass:${pass}`,
      "done",
      `${uncovered_ids.length} requirements remained after pass ${pass}`,
    );
  });
  await emit("flashcards", "running", "Building flashcards");
  const flashcards = await generateFlashcards({
    questions: generated.questions,
    ...(llm === undefined ? {} : { llm }),
    config: dependencies.config,
    budget,
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
  await emit("flashcards", "done", `Built ${flashcards.length} flashcards`);
  await emit("schedule", "running", "Allocating the exact study schedule");
  const schedule = allocateSchedule({
    requirements: role.requirements,
    questions: generated.questions,
    flashcards,
    daysAvailable: input.days,
  });
  await emit("schedule", "done", `Allocated exactly ${input.days} study days`);
  const gaps = findGaps(role.requirements, generated.questions);
  const warnings = dedupeWarnings([
    ...role.warnings,
    ...research.warnings,
    ...(generated.degraded
      ? [
          {
            code: "DEGRADED" as const,
            message: "Deterministic generation completed work that optional model calls could not.",
          },
        ]
      : []),
  ]);
  const researchedAt = isoWithoutMilliseconds(dependencies.clock.now());
  const rawKit: Kit = {
    source: {
      company: companyName,
      company_url: input.companyUrl,
      role: role.title,
      location: role.location,
      jd_chars: input.jd.length,
      researched_at: researchedAt,
      pages_used: research.pagesUsed,
    },
    company_brief: research.companyBrief,
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    },
    questions: generated.questions,
    flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: gaps.all,
      passes: generated.passes,
      history: generated.history,
    },
    hiring_process: research.hiringProcess,
    discussion: research.discussion,
    research_log: crawl.log,
    warnings,
  };
  await emit("validate_kit", "running", "Validating schema, references, coverage, and schedule");
  const allowedSources = new Set(crawl.pages.map(({ finalUrl }) => finalUrl));
  const kit = validateKit(repairKit(rawKit, allowedSources));
  await emit("validate_kit", "done", "Kit validation passed");
  await dependencies.store.save({ key: "latest", value: kit, savedAt: researchedAt });
  await emit("save/write", "done", "Kit is ready to write");
  return { kit, usage, retries: 0, durationMs: dependencies.clock.now() - started };
}

export async function runPipeline(
  input: PipelineInput,
  dependencies: PipelineDependencies,
): Promise<Kit> {
  return (await runPipelineWithMetrics(input, dependencies)).kit;
}
