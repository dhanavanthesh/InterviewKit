import type { RequirementKind, RequirementPriority, Warning } from "@interview-kit/schema";

import { groundRequirements, type GroundingResult, type RequirementCandidate } from "./grounding";
import { getJdLines, isBoilerplateHeading, normalizeForComparison } from "./preprocess";
import { inferRequirementPriority } from "./priority";

const REQUIREMENT_HEADING =
  /^(requirements?|qualifications?|preferred qualifications?|skills|experience|about you)$/i;
const DIRECT_REQUIREMENT =
  /\b(required|must(?: have)?|minimum|essential|preferred|nice to have|bonus|years? of experience|experience (?:with|in)|knowledge of|proficien(?:t|cy)|ability to|you will need|a plus)\b/i;
const UNTRUSTED_INSTRUCTION =
  /\b(ignore (?:all |any |the )?(?:previous|prior) instructions?|system message|assistant instructions?|reveal (?:a )?secret)\b/i;

function inferKind(text: string): RequirementKind {
  const normalized = normalizeForComparison(text);
  if (
    /\b(mentor|communicat|collaborat|leadership|stakeholder|teamwork|ownership)\w*/i.test(
      normalized,
    )
  ) {
    return "behavioural";
  }
  if (
    /\b(payment|financ|healthcare|insurance|compliance|banking|logistics|retail)\w*/i.test(
      normalized,
    )
  ) {
    return "domain";
  }
  return "technical";
}

function suppliedPriority(line: string, heading: string | null): RequirementPriority {
  return inferRequirementPriority(line, heading, "must");
}

function isCandidateLine(text: string, heading: string | null): boolean {
  if (UNTRUSTED_INSTRUCTION.test(text) || isBoilerplateHeading(heading)) return false;
  if (heading !== null && REQUIREMENT_HEADING.test(heading)) return true;
  return DIRECT_REQUIREMENT.test(text);
}

export interface FallbackExtractionResult extends GroundingResult {
  warnings: Warning[];
}

export function extractRequirementsFallback(jd: string): FallbackExtractionResult {
  const candidates: RequirementCandidate[] = getJdLines(jd)
    .filter(({ text, heading, isHeading }) => !isHeading && isCandidateLine(text, heading))
    .map(({ text, heading }) => ({
      text,
      evidence: text,
      kind: inferKind(text),
      priority: suppliedPriority(text, heading),
    }));
  const grounded = groundRequirements(jd, candidates);
  return {
    ...grounded,
    warnings: [
      {
        code: "EXTRACTION_FALLBACK",
        message: "Requirements were extracted using conservative posting cues.",
      },
      ...grounded.warnings,
    ],
  };
}
