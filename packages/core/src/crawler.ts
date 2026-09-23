import { getDomain } from "tldts";

import { PipelineError, asPipelineError } from "./errors";
import { classifyPage, rankLink } from "./html";
import { RobotsPolicyCache } from "./robots";
import type { Clock, CrawlResult, PageFetcher, PipelineConfig, RankedLink } from "./types";
import { isUrlInCompanyScope, parseHttpUrl } from "./url-safety";

interface QueueItem extends RankedLink {
  depth: number;
  order: number;
}

function companyScope(candidate: URL, root: URL): boolean {
  if (root.hostname === "localhost" || candidate.hostname === "localhost") {
    return isUrlInCompanyScope(candidate, root);
  }
  const rootDomain = getDomain(root.hostname, { allowPrivateDomains: true });
  const candidateDomain = getDomain(candidate.hostname, { allowPrivateDomains: true });
  return rootDomain !== null && candidateDomain === rootDomain;
}

function deriveCompanyName(pageTitle: string, siteName: string, root: URL): string {
  if (siteName.trim().length > 0) return siteName.trim();
  const titlePart = pageTitle.split(/[|\-–]/)[0]?.trim() ?? "";
  if (titlePart.length > 1 && titlePart.length < 80) return titlePart;
  const host = root.hostname.replace(/^www\./, "");
  return host === "localhost"
    ? (root.pathname.split("/").filter(Boolean)[0] ?? "")
    : (host.split(".")[0] ?? "");
}

export interface CrawlDependencies {
  fetcher: PageFetcher;
  config: PipelineConfig;
  clock: Clock;
}

export async function crawlCompanySite(
  companyUrl: string,
  dependencies: CrawlDependencies,
  signal?: AbortSignal,
): Promise<CrawlResult> {
  const root = parseHttpUrl(companyUrl);
  const robots = new RobotsPolicyCache(dependencies.fetcher, dependencies.config.crawlUserAgent);
  const queue: QueueItem[] = [
    {
      url: root.href,
      anchorText: "Homepage",
      sourceUrl: root.href,
      score: Number.MAX_SAFE_INTEGER,
      classificationHint: "homepage",
      depth: 0,
      order: 0,
    },
  ];
  const seen = new Set<string>();
  const queued = new Set([root.href]);
  const pages: CrawlResult["pages"] = [];
  const log: CrawlResult["log"] = [];
  const warnings: CrawlResult["warnings"] = [];
  const recordRobotsBlock = (url: string, reason: string): void => {
    log.push({ url, status: "blocked_by_robots", reason });
    if (!warnings.some(({ code }) => code === "ROBOTS_BLOCKED")) {
      warnings.push({
        code: "ROBOTS_BLOCKED",
        message: "One or more company pages were blocked by robots.txt.",
      });
    }
  };
  let sequence = 1;
  const deadline = dependencies.clock.now() + dependencies.config.researchTimeoutMs;

  while (
    queue.length > 0 &&
    pages.length < dependencies.config.crawlMaxPages &&
    dependencies.clock.now() < deadline &&
    signal?.aborted !== true
  ) {
    queue.sort(
      (left, right) =>
        right.score - left.score || left.depth - right.depth || left.order - right.order,
    );
    const item = queue.shift()!;
    queued.delete(item.url);
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const parsed = new URL(item.url);
    if (!companyScope(parsed, root)) {
      log.push({ url: item.url, status: "skipped", reason: "outside company domain scope" });
      continue;
    }
    const robotsDecision = await robots.check(item.url, signal);
    if (!robotsDecision.allowed) {
      recordRobotsBlock(item.url, robotsDecision.reason);
      continue;
    }
    try {
      const page = await dependencies.fetcher.fetch(item.url, {
        ...(signal === undefined ? {} : { signal }),
        beforeRedirect: async (target) => {
          const decision = await robots.check(target, signal);
          if (!decision.allowed) {
            throw new PipelineError(
              "ROBOTS_BLOCKED",
              `Redirect to ${target} is ${decision.reason}.`,
            );
          }
        },
      });
      page.classification =
        item.depth === 0 ? "homepage" : classifyPage({ ...page, rootUrl: root.href });
      if (page.noindex) {
        log.push({ url: page.finalUrl, status: "skipped", reason: "page requested noindex" });
      } else {
        pages.push(page);
        log.push({
          url: page.finalUrl,
          status: "used",
          reason: `${page.classification} page retrieved`,
        });
      }
      const maxDepth = page.classification === "hiring" ? 3 : 2;
      if (!page.nofollow && item.depth < maxDepth) {
        for (const link of page.links.map(rankLink)) {
          const candidate = new URL(link.url);
          if (!companyScope(candidate, root) || seen.has(link.url) || queued.has(link.url))
            continue;
          if (link.score < 0) {
            log.push({ url: link.url, status: "skipped", reason: "link ranked as irrelevant" });
            continue;
          }
          queued.add(link.url);
          queue.push({ ...link, depth: item.depth + 1, order: sequence });
          sequence += 1;
        }
      }
      for (const sitemap of robotsDecision.sitemaps) {
        try {
          const sitemapUrl = new URL(sitemap, page.finalUrl);
          if (
            !companyScope(sitemapUrl, root) ||
            seen.has(sitemapUrl.href) ||
            queued.has(sitemapUrl.href)
          )
            continue;
          const ranked = rankLink({
            url: sitemapUrl.href,
            anchorText: "Sitemap",
            sourceUrl: page.finalUrl,
          });
          queued.add(sitemapUrl.href);
          queue.push({ ...ranked, depth: 1, order: sequence });
          sequence += 1;
        } catch {
          // Invalid sitemap entries are ignored.
        }
      }
    } catch (error) {
      const failure = asPipelineError(error, "RETRIEVAL_FAILED");
      if (failure.code === "ROBOTS_BLOCKED") recordRobotsBlock(item.url, failure.message);
      else log.push({ url: item.url, status: "failed", reason: failure.message });
    }
  }

  if (pages.length === 0) {
    warnings.push({ code: "COMPANY_UNREACHABLE", message: "No company page could be retrieved." });
  }
  const homepage = pages.find(({ classification }) => classification === "homepage") ?? pages[0];
  return {
    pages,
    log,
    companyName:
      homepage === undefined
        ? deriveCompanyName("", "", root)
        : deriveCompanyName(homepage.title, homepage.siteName, root),
    warnings,
  };
}
