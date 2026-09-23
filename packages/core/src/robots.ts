import robotsParser, { type Robot } from "robots-parser";

import { PipelineError } from "./errors";
import type { PageFetcher } from "./types";

interface RobotsPolicy {
  robot: Robot | null;
  sitemaps: string[];
  blockedAll: boolean;
}

export interface RobotsDecision {
  allowed: boolean;
  sitemaps: string[];
  reason: string;
}

export class RobotsPolicyCache {
  private readonly cache = new Map<string, Promise<RobotsPolicy>>();

  constructor(
    private readonly fetcher: PageFetcher,
    private readonly userAgent: string,
  ) {}

  private load(url: URL, signal?: AbortSignal): Promise<RobotsPolicy> {
    const origin = url.origin;
    const existing = this.cache.get(origin);
    if (existing !== undefined) return existing;
    const promise = this.fetchPolicy(origin, signal);
    this.cache.set(origin, promise);
    return promise;
  }

  private async fetchPolicy(origin: string, signal?: AbortSignal): Promise<RobotsPolicy> {
    const robotsUrl = new URL("/robots.txt", origin).href;
    try {
      const page = await this.fetcher.fetch(robotsUrl, {
        ...(signal === undefined ? {} : { signal }),
        skipRobots: true,
      });
      const sitemaps = [...page.body.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map(
        (match) => match[1]!,
      );
      return { robot: robotsParser(robotsUrl, page.body), sitemaps, blockedAll: false };
    } catch (error) {
      if (error instanceof PipelineError && error.status !== undefined) {
        if (error.status >= 400 && error.status < 500) {
          return { robot: null, sitemaps: [], blockedAll: false };
        }
        if (error.status >= 500) return { robot: null, sitemaps: [], blockedAll: true };
      }
      return { robot: null, sitemaps: [], blockedAll: false };
    }
  }

  async check(url: string, signal?: AbortSignal): Promise<RobotsDecision> {
    const parsed = new URL(url);
    if (parsed.pathname === "/robots.txt") {
      return { allowed: true, sitemaps: [], reason: "robots policy request" };
    }
    const policy = await this.load(parsed, signal);
    if (policy.blockedAll) {
      return {
        allowed: false,
        sitemaps: policy.sitemaps,
        reason: "robots.txt was temporarily unavailable with a server error",
      };
    }
    const allowed = policy.robot?.isAllowed(url, this.userAgent) ?? true;
    return {
      allowed,
      sitemaps: policy.sitemaps,
      reason: allowed ? "allowed by robots.txt" : "disallowed by robots.txt",
    };
  }
}
