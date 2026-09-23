import * as cheerio from "cheerio";

import type { ExtractedLink, PageClassification, RankedLink, RetrievedPage } from "./types";

const BINARY_EXTENSION =
  /\.(?:avif|bmp|css|csv|docx?|gif|gz|ico|jpe?g|js|json|mov|mp3|mp4|mpeg|pdf|png|pptx?|rar|rss|svg|tar|webm|webp|xlsx?|xml|zip)$/i;
const IRRELEVANT_PATH =
  /(?:^|\/)(?:login|logout|sign-?in|sign-?up|auth|privacy|terms|legal|cookies?|cart|pricing|status|search)(?:\/|$)/i;

const HIRING = [
  "careers",
  "career",
  "jobs",
  "job",
  "hiring",
  "join",
  "interview",
  "recruiting",
  "recruitment",
  "apply",
  "handbook",
  "talent",
  "openings",
  "positions",
  "candidate",
  "process",
];
const ABOUT = ["about", "company", "mission", "team", "values", "story", "culture"];
const ENGINEERING = ["engineering", "blog", "technology", "tech"];
const NEGATIVE = [
  "login",
  "signup",
  "privacy",
  "terms",
  "legal",
  "cookies",
  "cart",
  "pricing",
  "status",
  "search",
];
const PROCESS_TERMS =
  /\b(interview|stage|round|take[ -]?home|onsite|recruiter|offer|hiring process|system design|architecture)\b/i;

function includesSignal(value: string, signal: string): boolean {
  return new RegExp(
    `(?:^|[^a-z0-9])${signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`,
    "i",
  ).test(value);
}

function signalScore(value: string, signals: readonly string[], weight: number): number {
  return signals.reduce((score, signal) => score + (includesSignal(value, signal) ? weight : 0), 0);
}

export function rankLink(link: ExtractedLink): RankedLink {
  const haystack = `${link.anchorText} ${new URL(link.url).pathname.replace(/[-_]/g, " ")}`;
  const hiringScore = signalScore(haystack, HIRING, 10);
  const aboutScore = signalScore(haystack, ABOUT, 6);
  const engineeringScore = signalScore(haystack, ENGINEERING, 3);
  const penalty = signalScore(haystack, NEGATIVE, 8);
  const classificationHint: PageClassification =
    hiringScore > 0
      ? "hiring"
      : aboutScore > 0
        ? "about"
        : engineeringScore > 0
          ? "engineering"
          : "other";
  return {
    ...link,
    score: hiringScore + aboutScore + engineeringScore - penalty,
    classificationHint,
  };
}

export function classifyPage(page: {
  finalUrl: string;
  title: string;
  headings: readonly string[];
  text: string;
  rootUrl?: string;
}): PageClassification {
  const url = new URL(page.finalUrl);
  if (page.rootUrl !== undefined && url.href === new URL(page.rootUrl).href) return "homepage";
  const signals = `${url.pathname.replace(/[-_]/g, " ")} ${page.title} ${page.headings.join(" ")}`;
  const hiring = signalScore(signals, HIRING, 10);
  if (hiring > 0 && PROCESS_TERMS.test(page.text)) return "hiring";
  if (signalScore(signals, ABOUT, 6) > 0) return "about";
  if (signalScore(signals, ENGINEERING, 3) > 0) return "engineering";
  return "other";
}

function normalizeUrl(value: string, base: URL): string | undefined {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.hash = "";
  if (BINARY_EXTENSION.test(url.pathname) || IRRELEVANT_PATH.test(url.pathname)) return undefined;
  return url.href;
}

export function parseHtmlDocument(
  html: string,
  requestedUrl: string,
  finalUrl: string,
  status: number,
  contentType: string,
  headers: Record<string, string>,
  maxTextChars = 24_000,
): RetrievedPage {
  const $ = cheerio.load(html);
  const declaredBase = $("base[href]").first().attr("href");
  let base = new URL(finalUrl);
  if (declaredBase !== undefined) {
    try {
      const candidate = new URL(declaredBase, base);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") base = candidate;
    } catch {
      // An invalid base is ignored and the final response URL remains authoritative.
    }
  }
  const linksByUrl = new Map<string, ExtractedLink>();
  $("a[href]").each((_index, element) => {
    const normalized = normalizeUrl($(element).attr("href") ?? "", base);
    if (normalized === undefined || linksByUrl.has(normalized)) return;
    linksByUrl.set(normalized, {
      url: normalized,
      anchorText: $(element).text().replace(/\s+/g, " ").trim(),
      sourceUrl: finalUrl,
    });
  });
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const siteName = $('meta[property="og:site_name"]').attr("content")?.trim() ?? "";
  const headings = $("h1, h2, h3")
    .map((_index, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((value) => value.length > 0);
  const robots = [$('meta[name="robots"]').attr("content") ?? "", headers["x-robots-tag"] ?? ""]
    .join(",")
    .toLowerCase();
  $(
    "script, style, noscript, svg, iframe, form, nav, footer, header, [hidden], [aria-hidden='true']",
  ).remove();
  $("*")
    .contents()
    .filter((_index, node) => node.type.toString() === "comment")
    .remove();
  const readable = $("main, article").first();
  const textRoot = readable.length > 0 ? readable : $("body");
  textRoot.find("h1, h2, h3, h4, h5, h6, p, li, td, th, br").each((_index, element) => {
    $(element).prepend(" ").append(" ");
  });
  const text = textRoot.text().replace(/\s+/g, " ").trim().slice(0, maxTextChars);
  const page: RetrievedPage = {
    requestedUrl,
    finalUrl,
    status,
    contentType,
    headers,
    body: html,
    title,
    siteName,
    headings,
    text,
    links: [...linksByUrl.values()],
    classification: "other",
    noindex: /(?:^|[,\s])noindex(?:$|[,\s])/.test(robots),
    nofollow: /(?:^|[,\s])nofollow(?:$|[,\s])/.test(robots),
  };
  page.classification = classifyPage(page);
  return page;
}
