import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startFixtureServer } from "../../../fixtures/sites/server";
import { systemClock } from "../src/clock";
import { parseConfig } from "../src/config";
import { crawlCompanySite } from "../src/crawler";
import { createPageFetcher } from "../src/fetcher";
import { RobotsPolicyCache } from "../src/robots";
import type { PageFetcher, RetrievedPage } from "../src/types";

const config = parseConfig({
  ALLOW_PRIVATE_HOSTS: "true",
  CRAWL_TIMEOUT_MS: "500",
  CRAWL_MAX_BYTES: "100000",
  RESEARCH_TIMEOUT_MS: "5000",
  CRAWL_MAX_PAGES: "10",
});

let origin: string;
let close: () => Promise<void>;
let fetcher: PageFetcher;

beforeAll(async () => {
  const fixture = await startFixtureServer();
  origin = fixture.origin;
  close = fixture.close;
  fetcher = createPageFetcher({ config, clock: systemClock, random: () => 0 });
});

afterAll(async () => close());

describe("bounded page fetcher", () => {
  it("follows relative redirects and returns the final URL", async () => {
    const result = await fetcher.fetch(`${origin}/relative/`);
    expect(result.finalUrl).toBe(`${origin}/relative/home/`);
  });

  it("rejects redirect loops", async () => {
    await expect(fetcher.fetch(`${origin}/failures/redirect-loop`)).rejects.toMatchObject({
      code: "REDIRECT_LOOP",
    });
  });

  it("maps 404 responses to structured failures", async () => {
    await expect(fetcher.fetch(`${origin}/missing`)).rejects.toMatchObject({
      code: "HTTP_STATUS",
      status: 404,
    });
  });

  it("retries 429 and 5xx responses", async () => {
    await expect(fetcher.fetch(`${origin}/failures/retry-429`)).resolves.toMatchObject({
      status: 200,
    });
    await expect(fetcher.fetch(`${origin}/failures/retry-500`)).resolves.toMatchObject({
      status: 200,
    });
  });

  it("rejects oversized and binary content", async () => {
    await expect(fetcher.fetch(`${origin}/failures/oversized`)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });
    await expect(fetcher.fetch(`${origin}/failures/binary`)).rejects.toMatchObject({
      code: "CONTENT_TYPE_UNSUPPORTED",
    });
  });

  it("sniffs HTML when content type is absent", async () => {
    await expect(fetcher.fetch(`${origin}/failures/no-content-type`)).resolves.toMatchObject({
      text: "Readable HTML",
    });
  });

  it("supports cancellation and timeouts", async () => {
    const controller = new AbortController();
    const operation = fetcher.fetch(`${origin}/failures/delayed`, { signal: controller.signal });
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("robots policy", () => {
  it("blocks a disallowed page and allows a public page", async () => {
    const robots = new RobotsPolicyCache(fetcher, config.crawlUserAgent);
    await expect(robots.check(`${origin}/robots-blocked/private-hiring`)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(robots.check(`${origin}/robots-blocked/`)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("parses sitemap hints and caches robots per host", async () => {
    let calls = 0;
    const fake: PageFetcher = {
      fetch: (url) => {
        calls += 1;
        return Promise.resolve({
          requestedUrl: url,
          finalUrl: url,
          status: 200,
          contentType: "text/plain",
          headers: {},
          body: "User-agent: *\nAllow: /\nSitemap: https://example.com/site.xml",
          title: "",
          siteName: "",
          headings: [],
          text: "",
          links: [],
          classification: "other",
          noindex: false,
          nofollow: false,
        } satisfies RetrievedPage);
      },
    };
    const robots = new RobotsPolicyCache(fake, "TestBot");
    const first = await robots.check("https://example.com/a");
    await robots.check("https://example.com/b");
    expect(first.sitemaps).toEqual(["https://example.com/site.xml"]);
    expect(calls).toBe(1);
  });
});

describe("bounded crawler", () => {
  it("finds footer-only careers and an unusual nested hiring page", async () => {
    const result = await crawlCompanySite(`${origin}/normal/`, {
      fetcher,
      config,
      clock: systemClock,
    });
    expect(result.pages.some(({ classification }) => classification === "hiring")).toBe(true);
  });

  it("follows relative links under a path-prefixed localhost root", async () => {
    const result = await crawlCompanySite(`${origin}/relative/`, {
      fetcher,
      config,
      clock: systemClock,
    });
    expect(result.pages.map(({ finalUrl }) => finalUrl)).toContain(
      `${origin}/relative/paths/join-us`,
    );
    expect(result.pages.every(({ finalUrl }) => finalUrl.startsWith(`${origin}/relative/`))).toBe(
      true,
    );
  });

  it("does not classify a team page as hiring", async () => {
    const result = await crawlCompanySite(`${origin}/no-hiring/`, {
      fetcher,
      config,
      clock: systemClock,
    });
    expect(result.pages.some(({ classification }) => classification === "hiring")).toBe(false);
  });

  it("records robots blocks without fetching the blocked page", async () => {
    const result = await crawlCompanySite(`${origin}/robots-blocked/`, {
      fetcher,
      config,
      clock: systemClock,
    });
    expect(result.log).toContainEqual(
      expect.objectContaining({
        status: "blocked_by_robots",
        url: `${origin}/robots-blocked/private-hiring`,
      }),
    );
  });

  it("refuses a redirect from an allowed page to a robots-disallowed page", async () => {
    const requested: string[] = [];
    const spyingFetcher = createPageFetcher({
      config,
      clock: systemClock,
      random: () => 0,
      request: (input, init) => {
        // The fetcher always requests a validated URL object.
        requested.push(input instanceof URL ? input.href : (input as string));
        return undiciFetch(input, init);
      },
    });
    const result = await crawlCompanySite(`${origin}/robots-redirect/`, {
      fetcher: spyingFetcher,
      config,
      clock: systemClock,
    });
    expect(requested).toContain(`${origin}/robots-redirect/careers`);
    expect(requested).not.toContain(`${origin}/robots-blocked/private-hiring`);
    expect(result.log).toContainEqual(
      expect.objectContaining({
        status: "blocked_by_robots",
        url: `${origin}/robots-redirect/careers`,
      }),
    );
    expect(result.warnings.map(({ code }) => code)).toContain("ROBOTS_BLOCKED");
    expect(result.pages.map(({ finalUrl }) => finalUrl)).not.toContain(
      `${origin}/robots-blocked/private-hiring`,
    );
  });
});
