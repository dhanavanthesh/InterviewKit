import type { Requirement, Warning } from "@interview-kit/schema";
import { z } from "zod";

import { extractRequirementsFallback } from "./fallback-extractor";
import { groundRequirements, type RequirementCandidate } from "./grounding";
import type { KitTokenBudget } from "./limiter";
import { getJdLines, normalizeForComparison, splitJobDescription } from "./preprocess";
import type { LlmClient, PipelineConfig } from "./types";

const candidateRequirementSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["technical", "behavioural", "domain"]),
  priority: z.enum(["must", "nice"]),
  evidence: z.string().min(1),
});

const extractionSchema = z.object({
  company_name: z.string(),
  title: z.string(),
  title_evidence: z.string(),
  seniority: z.string(),
  seniority_evidence: z.string(),
  location: z.string(),
  location_evidence: z.string(),
  responsibilities: z.array(z.object({ text: z.string().min(1), evidence: z.string().min(1) })),
  requirements: z.array(candidateRequirementSchema),
});

type ExtractionDraft = z.infer<typeof extractionSchema>;

export interface ExtractedRole {
  companyNameHint: string;
  title: string;
  seniority: string;
  location: string;
  responsibilities: string[];
  requirements: Requirement[];
  warnings: Warning[];
}

function evidenceLine(jd: string, evidence: string): string | undefined {
  const normalized = normalizeForComparison(evidence);
  if (normalized.length === 0) return undefined;
  return getJdLines(jd)
    .filter(({ isHeading }) => !isHeading)
    .find(({ normalized: line }) => line.includes(normalized))?.text;
}

function groundedValue(jd: string, value: string, evidence: string): string {
  if (value.trim().length === 0) return "";
  return evidenceLine(jd, evidence) === undefined ? "" : value.trim();
}

function fallbackRole(jd: string): Omit<ExtractedRole, "requirements" | "warnings"> {
  const lines = getJdLines(jd);
  const first = lines.find(({ isHeading }) => !isHeading)?.text ?? "";
  const title =
    first.length <= 100 &&
    /\b(engineer|developer|designer|manager|analyst|architect|specialist|lead)\b/i.test(first)
      ? first
      : "";
  const responsibilities = lines
    .filter(
      ({ isHeading, heading }) =>
        !isHeading && /responsibilities|what you(?:'|’)ll do/i.test(heading ?? ""),
    )
    .map(({ text }) => text);
  return { companyNameHint: "", title, seniority: "", location: "", responsibilities };
}

export async function extractRoleAndRequirements(input: {
  jd: string;
  llm?: LlmClient;
  config: PipelineConfig;
  budget: KitTokenBudget;
  signal?: AbortSignal;
}): Promise<ExtractedRole> {
  const chunks = splitJobDescription(input.jd);
  const drafts: ExtractionDraft[] = [];
  let llmFailed = input.llm === undefined;
  if (input.llm !== undefined) {
    for (const [index, chunk] of chunks.entries()) {
      const tokenCap = 1800;
      if (!input.budget.canReserve(tokenCap)) {
        llmFailed = true;
        break;
      }
      try {
        const response = await input.llm.complete({
          model: input.config.mainModel,
          system:
            "Extract the role and one candidate requirement per genuine posting statement. Copy evidence verbatim. Do not turn the title into a requirement. Preserve must and nice statements separately.",
          data: { chunk_index: index, chunk_count: chunks.length, job_description: chunk },
          schema: extractionSchema,
          schemaName: "job_extraction",
          maxCompletionTokens: tokenCap,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          category: "extraction",
        });
        input.budget.record(response.usage);
        drafts.push(response.value);
      } catch {
        llmFailed = true;
        break;
      }
    }
  }

  if (llmFailed || drafts.length === 0) {
    const fallback = extractRequirementsFallback(input.jd);
    return {
      ...fallbackRole(input.jd),
      requirements: fallback.requirements,
      warnings: fallback.warnings,
    };
  }

  const candidates = drafts.flatMap(({ requirements }) => requirements) as RequirementCandidate[];
  const grounded = groundRequirements(input.jd, candidates);
  const primary = drafts[0]!;
  const responsibilities = drafts
    .flatMap(({ responsibilities }) => responsibilities)
    .flatMap(({ text, evidence }) =>
      evidenceLine(input.jd, evidence) === undefined ? [] : [text.trim()],
    );
  return {
    companyNameHint: groundedValue(input.jd, primary.company_name, primary.company_name),
    title: groundedValue(input.jd, primary.title, primary.title_evidence),
    seniority: groundedValue(input.jd, primary.seniority, primary.seniority_evidence),
    location: groundedValue(input.jd, primary.location, primary.location_evidence),
    responsibilities: [...new Set(responsibilities)],
    requirements: grounded.requirements,
    warnings: grounded.warnings,
  };
}
