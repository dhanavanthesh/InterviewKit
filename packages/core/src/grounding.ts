import type {
  Requirement,
  RequirementKind,
  RequirementPriority,
  Warning,
} from "@interview-kit/schema";

import { getJdLines, normalizeForComparison, normalizeJobDescription } from "./preprocess";
import { inferRequirementPriority } from "./priority";

export interface RequirementCandidate {
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  evidence: string;
}

export interface DroppedRequirement {
  candidate: RequirementCandidate;
  reason: "EMPTY_EVIDENCE" | "EVIDENCE_NOT_FOUND";
}

export interface GroundingResult {
  requirements: Array<Requirement & { evidence: string }>;
  dropped: DroppedRequirement[];
  warnings: Warning[];
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeForComparison(value)
      .split(/[^\p{L}\p{N}+#.]+/u)
      .filter((token) => token.length > 0),
  );
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Evidence must appear inside a JD line as whole words; a longer claim never matches a shorter line.
function containsPhrase(line: string, phrase: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, "u").test(line);
}

function findEvidenceLine(jd: string, evidence: string) {
  const normalizedEvidence = normalizeForComparison(evidence);
  if (normalizedEvidence.length === 0) return undefined;
  const lines = getJdLines(jd).filter(({ isHeading }) => !isHeading);
  const exactLine = lines.find(({ normalized }) => containsPhrase(normalized, normalizedEvidence));
  if (exactLine !== undefined) return exactLine;
  return lines
    .map((line) => ({ line, score: tokenOverlap(normalizedEvidence, line.normalized) }))
    .filter(({ score }) => score >= 0.8)
    .sort((left, right) => right.score - left.score || left.line.index - right.line.index)[0]?.line;
}

function deduplicate(
  grounded: Array<{
    requirement: RequirementCandidate;
    evidence: string;
    position: number;
    heading: string | null;
  }>,
) {
  const deduplicated: typeof grounded = [];
  for (const item of grounded.sort((left, right) => left.position - right.position)) {
    const evidenceKey = normalizeForComparison(item.evidence);
    const textKey = normalizeForComparison(item.requirement.text);
    const duplicate = deduplicated.find(
      (existing) =>
        normalizeForComparison(existing.evidence) === evidenceKey ||
        (normalizeForComparison(existing.requirement.text) === textKey &&
          existing.requirement.priority === item.requirement.priority),
    );
    if (duplicate === undefined) {
      deduplicated.push(item);
    } else if (item.requirement.priority === "must") {
      duplicate.requirement = { ...duplicate.requirement, priority: "must" };
    }
  }
  return deduplicated;
}

export function groundRequirements(
  jd: string,
  candidates: readonly RequirementCandidate[],
): GroundingResult {
  const normalizedJd = normalizeJobDescription(jd);
  const dropped: DroppedRequirement[] = [];
  const grounded: Array<{
    requirement: RequirementCandidate;
    evidence: string;
    position: number;
    heading: string | null;
  }> = [];

  for (const candidate of candidates) {
    if (normalizeForComparison(candidate.evidence).length === 0) {
      dropped.push({ candidate, reason: "EMPTY_EVIDENCE" });
      continue;
    }
    const line = findEvidenceLine(normalizedJd, candidate.evidence);
    if (line === undefined) {
      dropped.push({ candidate, reason: "EVIDENCE_NOT_FOUND" });
      continue;
    }
    grounded.push({
      requirement: candidate,
      evidence: line.text,
      position: line.index,
      heading: line.heading,
    });
  }

  const requirements = deduplicate(grounded).map((item, index) => ({
    id: `r${index + 1}`,
    text: item.requirement.text.trim(),
    kind: item.requirement.kind,
    priority: inferRequirementPriority(item.evidence, item.heading, item.requirement.priority),
    evidence: item.evidence,
    origin: "generated" as const,
  }));
  const warnings: Warning[] = [];
  if (normalizeForComparison(jd).length < 160) {
    warnings.push({ code: "THIN_JD", message: "The job description contains very little detail." });
  }
  if (requirements.length === 0) {
    warnings.push({
      code: "NO_EXPLICIT_REQUIREMENTS",
      message: "No explicit requirements could be grounded in the job description.",
    });
  }
  return { requirements, dropped, warnings };
}
