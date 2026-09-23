import type { Kit, Warning } from "@interview-kit/schema";
import { z } from "zod";

import type { KitTokenBudget } from "./limiter";
import { normalizeForComparison } from "./preprocess";
import { safeHostname } from "./url-safety";
import type {
  CrawlResult,
  DiscussionResult,
  LlmClient,
  PipelineConfig,
  RetrievedPage,
} from "./types";

const hiringSchema = z.object({
  stages: z.array(z.string().min(1)),
  notes: z.string(),
  sources: z.array(z.string()),
});

const briefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

const discussionSchema = z.object({ summary: z.string(), sources: z.array(z.string()) });

export interface ResearchGenerationResult {
  companyBrief: Kit["company_brief"];
  hiringProcess: NonNullable<Kit["hiring_process"]> | null;
  discussion: NonNullable<Kit["discussion"]> | null;
  warnings: Warning[];
  pagesUsed: string[];
}

function significantTokens(value: string): string[] {
  return normalizeForComparison(value)
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter(
      (token) =>
        token.length >= 4 && !new Set(["with", "from", "then", "will", "your", "about"]).has(token),
    );
}

function supportedByPages(value: string, pages: readonly RetrievedPage[]): boolean {
  const stageTokens = significantTokens(value);
  if (stageTokens.length === 0) return false;
  return pages.some((page) => {
    const pageTokens = new Set(significantTokens(page.text));
    const shared = stageTokens.filter((token) => pageTokens.has(token)).length;
    return shared / stageTokens.length >= 0.7;
  });
}

function deterministicHiring(pages: readonly RetrievedPage[]) {
  const stages: string[] = [];
  const sourceSet = new Set<string>();
  const patterns: Array<[RegExp, string]> = [
    [/\brecruiter (?:conversation|call|screen)\b/i, "Recruiter conversation"],
    [/\btake[ -]?home (?:exercise|assignment|challenge)\b/i, "Take-home exercise"],
    [/\bsystem[ -]?design (?:round|interview|session)\b/i, "System-design round"],
    [/\btechnical (?:interview|round|screen)\b/i, "Technical interview"],
    [/\b(?:final|team) (?:interview|round)\b/i, "Final interview"],
  ];
  for (const page of pages) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(page.text) && !stages.includes(label)) {
        stages.push(label);
        sourceSet.add(page.finalUrl);
      }
    }
  }
  return stages.length === 0
    ? null
    : {
        stages,
        notes: "Stages are taken from the company's published hiring material.",
        sources: [...sourceSet],
      };
}

function honestBrief(crawl: CrawlResult, companyUrl: string): Kit["company_brief"] {
  const usable = crawl.pages.filter(
    ({ classification, text }) =>
      (classification === "homepage" || classification === "about") && text.length > 0,
  );
  if (usable.length === 0) {
    return {
      summary: `Little public information could be retrieved from ${safeHostname(companyUrl) ?? "the company website"}.`,
      what_they_do: "",
      sources: [],
    };
  }
  const page = usable[0]!;
  const firstSentence = page.text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 400) ?? "";
  return { summary: firstSentence, what_they_do: firstSentence, sources: [page.finalUrl] };
}

export async function generateResearch(input: {
  crawl: CrawlResult;
  discussionResult: DiscussionResult;
  companyUrl: string;
  llm?: LlmClient;
  config: PipelineConfig;
  budget: KitTokenBudget;
  signal?: AbortSignal;
}): Promise<ResearchGenerationResult> {
  const warnings = [...input.crawl.warnings];
  const pagesUsed = new Set<string>();
  const hiringPages = input.crawl.pages.filter(({ classification }) => classification === "hiring");
  let hiringProcess: ResearchGenerationResult["hiringProcess"] = null;
  if (hiringPages.length > 0) {
    hiringPages.forEach(({ finalUrl }) => pagesUsed.add(finalUrl));
    if (input.llm !== undefined && input.budget.canReserve(900)) {
      try {
        const response = await input.llm.complete({
          model: input.config.lightModel,
          system: "Extract only explicitly described hiring stages. Use only supplied source URLs.",
          data: hiringPages.map(({ finalUrl, text }) => ({ url: finalUrl, text })),
          schema: hiringSchema,
          schemaName: "hiring_process",
          maxCompletionTokens: 900,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          optional: true,
          category: "hiring",
        });
        input.budget.record(response.usage);
        const allowedSources = new Set(hiringPages.map(({ finalUrl }) => finalUrl));
        const stages = response.value.stages.filter((stage) =>
          supportedByPages(stage, hiringPages),
        );
        if (stages.length > 0) {
          hiringProcess = {
            stages,
            notes: response.value.notes,
            sources: response.value.sources.filter((url) => allowedSources.has(url)),
          };
        }
      } catch {
        hiringProcess = deterministicHiring(hiringPages);
      }
    } else {
      hiringProcess = deterministicHiring(hiringPages);
    }
  }
  if (hiringProcess === null) {
    warnings.push({
      code: "NO_HIRING_PAGE",
      message: "No supported hiring-process stages were found.",
    });
  }

  const briefPages = input.crawl.pages.filter(
    ({ classification }) => classification === "homepage" || classification === "about",
  );
  let companyBrief = honestBrief(input.crawl, input.companyUrl);
  if (briefPages.length === 0) {
    warnings.push({
      code: "NO_ABOUT_CONTENT",
      message: "No usable company overview content was found.",
    });
  } else {
    briefPages.forEach(({ finalUrl }) => pagesUsed.add(finalUrl));
    if (input.llm !== undefined && input.budget.canReserve(900)) {
      try {
        const response = await input.llm.complete({
          model: input.config.lightModel,
          system:
            "Write a concise factual company brief using only the supplied page text and source URLs.",
          data: briefPages.map(({ finalUrl, text }) => ({ url: finalUrl, text })),
          schema: briefSchema,
          schemaName: "company_brief",
          maxCompletionTokens: 900,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          optional: true,
          category: "brief",
        });
        input.budget.record(response.usage);
        const allowedSources = new Set(briefPages.map(({ finalUrl }) => finalUrl));
        companyBrief = {
          summary: response.value.summary,
          what_they_do: response.value.what_they_do,
          sources: response.value.sources.filter((url) => allowedSources.has(url)),
        };
      } catch {
        companyBrief = honestBrief(input.crawl, input.companyUrl);
      }
    }
  }

  let discussion: ResearchGenerationResult["discussion"] = null;
  if (!input.discussionResult.failed && input.discussionResult.hits.length >= 2) {
    if (input.llm !== undefined && input.budget.canReserve(600)) {
      try {
        const response = await input.llm.complete({
          model: input.config.lightModel,
          system: "Summarize the relevant public interview discussion using only supplied results.",
          data: input.discussionResult.hits,
          schema: discussionSchema,
          schemaName: "discussion_summary",
          maxCompletionTokens: 600,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          optional: true,
        });
        input.budget.record(response.usage);
        const allowed = new Set(input.discussionResult.hits.map(({ url }) => url));
        discussion = {
          summary: response.value.summary,
          sources: response.value.sources.filter((url) => allowed.has(url)),
        };
      } catch {
        discussion = null;
      }
    }
  }
  if (discussion === null) {
    warnings.push({
      code: "NO_PUBLIC_DISCUSSION",
      message: "No sufficiently relevant public interview discussion was found.",
    });
  }
  if (input.budget.usage >= input.config.kitTokenBudget) {
    warnings.push({
      code: "DEGRADED",
      message: "Optional generation was reduced to stay within the token budget.",
    });
  }
  return { companyBrief, hiringProcess, discussion, warnings, pagesUsed: [...pagesUsed] };
}
