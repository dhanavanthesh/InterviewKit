import type { Clock, DiscussionHit, DiscussionResult, DiscussionSearcher } from "./types";
import { safeHostname } from "./url-safety";

interface AlgoliaHit {
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  url?: string | null;
  story_url?: string | null;
  objectID?: string;
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
}

const INTERVIEW_TERMS =
  /\b(interview|hiring process|onsite|take[ -]?home|recruiter|offer|hiring round)\b/i;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactCompany(value: string, companyName: string, domain: string): boolean {
  const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameMatches =
    companyName.length >= 3 &&
    new RegExp(`(?:^|[^a-z0-9-])${escaped}(?:$|[^a-z0-9-])`, "i").test(value);
  return nameMatches || (domain.length > 0 && value.toLowerCase().includes(domain.toLowerCase()));
}

export function filterDiscussionHits(
  hits: readonly AlgoliaHit[],
  companyName: string,
  companyUrl: string,
): DiscussionHit[] {
  const domain = safeHostname(companyUrl) ?? "";
  return hits.flatMap((hit) => {
    const title = hit.title ?? hit.story_title ?? "";
    const text = stripHtml(hit.comment_text ?? hit.story_text ?? "");
    const combined = `${title} ${text} ${hit.url ?? ""} ${hit.story_url ?? ""}`;
    if (!exactCompany(combined, companyName, domain) || !INTERVIEW_TERMS.test(combined)) return [];
    const url =
      hit.url ??
      hit.story_url ??
      (hit.objectID === undefined ? "" : `https://news.ycombinator.com/item?id=${hit.objectID}`);
    if (url.length === 0) return [];
    return [{ title, text, url }];
  });
}

export interface DiscussionSearchDependencies {
  clock: Clock;
  request?: typeof fetch;
  timeoutMs?: number;
}

export function createDiscussionSearcher(
  dependencies: DiscussionSearchDependencies,
): DiscussionSearcher {
  const request = dependencies.request ?? fetch;
  const cache = new Map<string, Promise<DiscussionResult>>();
  return {
    search(companyName, companyUrl, signal) {
      const domain = safeHostname(companyUrl) ?? "";
      const cacheKey = `${companyName.toLowerCase()}|${domain}`;
      const existing = cache.get(cacheKey);
      if (existing !== undefined) return existing;
      const operation = (async (): Promise<DiscussionResult> => {
        const queries = [companyName, domain]
          .filter((term) => term.trim().length > 0)
          .map((term) => `${term} interview`);
        if (queries.length === 0) return { hits: [], failed: false };
        const rawHits: AlgoliaHit[] = [];
        try {
          for (const query of queries) {
            let response: Response | undefined;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 5000);
              const abort = () => controller.abort();
              signal?.addEventListener("abort", abort, { once: true });
              try {
                const url = new URL("https://hn.algolia.com/api/v1/search");
                url.searchParams.set("query", query);
                url.searchParams.set("tags", "(story,comment)");
                url.searchParams.set("hitsPerPage", "20");
                response = await request(url, { signal: controller.signal });
              } finally {
                clearTimeout(timer);
                signal?.removeEventListener("abort", abort);
              }
              if (response.ok) break;
              if (response.status < 500 && response.status !== 429)
                return { hits: [], failed: true };
              if (attempt === 0) await dependencies.clock.sleep(200, signal);
            }
            if (response === undefined || !response.ok) return { hits: [], failed: true };
            const data = (await response.json()) as AlgoliaResponse;
            rawHits.push(...(data.hits ?? []));
          }
          const filtered = filterDiscussionHits(rawHits, companyName, companyUrl);
          return {
            hits: [...new Map(filtered.map((hit) => [hit.url, hit])).values()],
            failed: false,
          };
        } catch {
          return { hits: [], failed: true };
        }
      })();
      cache.set(cacheKey, operation);
      return operation;
    },
  };
}
