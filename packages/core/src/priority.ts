import type { RequirementPriority } from "@interview-kit/schema";

import { normalizeForComparison } from "./preprocess";

const NICE_CUES = [
  "nice to have",
  "nice if you have",
  "bonus points",
  "bonus",
  "preferred qualifications",
  "preferred",
  "a plus",
  "ideally",
  "desirable",
  "good to have",
  "advantage",
  "optional",
];
const MUST_CUES = [
  "basic qualifications",
  "you will need",
  "must have",
  "requirements",
  "requirement",
  "required",
  "must",
  "minimum qualifications",
  "minimum",
  "essential",
];

function hasPhrase(value: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(value);
}

function explicitPriority(value: string): RequirementPriority | null {
  const normalized = normalizeForComparison(value);
  if (NICE_CUES.some((cue) => hasPhrase(normalized, cue))) return "nice";
  if (MUST_CUES.some((cue) => hasPhrase(normalized, cue))) return "must";
  return null;
}

export function inferRequirementPriority(
  line: string,
  heading: string | null,
  supplied: RequirementPriority,
): RequirementPriority {
  return (
    explicitPriority(line) ?? (heading === null ? null : explicitPriority(heading)) ?? supplied
  );
}
