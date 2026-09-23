export interface JdLine {
  text: string;
  normalized: string;
  index: number;
  heading: string | null;
  isHeading: boolean;
}

const HEADING_WORD_LIMIT = 8;

export function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/^[\s\-\u2022\u25E6\u25AA*]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

export function normalizeJobDescription(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/^[ \t]*[\u2022\u25E6\u25AA*][ \t]*/gmu, "- ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function looksLikeHeading(text: string): boolean {
  const clean = text.replace(/:$/, "").trim();
  if (clean.length === 0 || clean.length > 80 || clean.split(/\s+/).length > HEADING_WORD_LIMIT) {
    return false;
  }
  if (text.trim().endsWith(":")) return true;
  if (/^[A-Z][A-Z\s&/-]+$/.test(clean)) return true;
  return /^(requirements?|qualifications?|preferred qualifications?|what you(?:'|’)ll do|responsibilities|skills|experience|about (?:you|the role)|benefits|perks|what we offer|equal opportunity)$/i.test(
    clean,
  );
}

export function getJdLines(jd: string): JdLine[] {
  const normalized = normalizeJobDescription(jd);
  const lines: JdLine[] = [];
  let heading: string | null = null;
  normalized.split("\n").forEach((raw, index) => {
    const text = raw
      .trim()
      .replace(/^-[ \t]*/, "")
      .trim();
    if (text.length === 0) return;
    const isHeading = looksLikeHeading(text);
    if (isHeading) heading = text.replace(/:$/, "").trim();
    lines.push({ text, normalized: normalizeForComparison(text), index, heading, isHeading });
  });
  return lines;
}

export function isBoilerplateHeading(heading: string | null): boolean {
  return heading !== null && /^(benefits|perks|what we offer|equal opportunity)/i.test(heading);
}

export function splitJobDescription(jd: string, maxChars = 6_000): string[] {
  const normalized = normalizeJobDescription(jd);
  if (normalized.length <= maxChars) return normalized.length === 0 ? [] : [normalized];

  const sections: string[] = [];
  let current = "";
  for (const line of normalized.split("\n")) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > maxChars && current.length > 0) {
      sections.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}
