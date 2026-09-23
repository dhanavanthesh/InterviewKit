import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config";
import { classifyPage, parseHtmlDocument, rankLink } from "../src/html";
import { PipelineError } from "../src/errors";
import {
  isBlockedAddress,
  isUrlInCompanyScope,
  parseHttpUrl,
  validateUrl,
  type HostResolver,
} from "../src/url-safety";

const resolver = (address: string): HostResolver => ({
  resolve: () =>
    Promise.resolve([{ address, family: address.includes(":") ? (6 as const) : (4 as const) }]),
});

describe("configuration", () => {
  it("loads safe numeric defaults without an API key", () => {
    const config = parseConfig({});
    expect(config.groqApiKey).toBeUndefined();
    expect(config.crawlMaxPages).toBe(10);
    expect(config.allowPrivateHosts).toBe(false);
  });

  it("rejects invalid numeric limits", () => {
    expect(() => parseConfig({ CRAWL_MAX_PAGES: "0" })).toThrow(PipelineError);
  });
});

describe("URL safety", () => {
  it.each(["http://example.com", "https://example.com/path"])("accepts %s", (url) => {
    expect(parseHttpUrl(url).protocol).toMatch(/^https?:$/);
  });

  it.each(["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"])(
    "rejects unsupported URL %s",
    (url) => expect(() => parseHttpUrl(url)).toThrow("Only HTTP and HTTPS"),
  );

  it("rejects embedded credentials", () => {
    expect(() => parseHttpUrl("https://user:pass@example.com")).toThrow("credentials");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.1.2.3",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks non-public address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it("rejects a public hostname resolving to private space", async () => {
    await expect(
      validateUrl("https://public.example", {
        allowPrivateHosts: false,
        resolver: resolver("10.0.0.7"),
      }),
    ).rejects.toMatchObject({ code: "URL_BLOCKED" });
  });

  it("allows localhost only in explicit evaluator mode", async () => {
    const result = await validateUrl("http://localhost:8099", {
      allowPrivateHosts: true,
      resolver: resolver("127.0.0.1"),
    });
    expect(result.url).toBeInstanceOf(URL);
  });

  it("keeps localhost navigation inside its path prefix", () => {
    const root = new URL("http://localhost:8099/acme/");
    expect(isUrlInCompanyScope(new URL("http://localhost:8099/acme/jobs"), root)).toBe(true);
    expect(isUrlInCompanyScope(new URL("http://localhost:8099/other/jobs"), root)).toBe(false);
  });
});

describe("HTML extraction and ranking", () => {
  const document = parseHtmlDocument(
    `<!doctype html><html><head><title>Acme Careers</title><base href="/company/"></head>
      <body><footer><a href="candidate/process">Interview process</a></footer>
      <main><h1>How we hire</h1><p>Recruiter conversation</p><p>System design round</p>
      <a href="mailto:jobs@example.com">Email</a><a href="/privacy">Privacy</a></main></body></html>`,
    "https://example.com/start",
    "https://example.com/start",
    200,
    "text/html",
    {},
  );

  it("extracts footer links before removing navigation noise", () => {
    expect(document.links.map(({ url }) => url)).toContain(
      "https://example.com/company/candidate/process",
    );
  });

  it("filters mail, legal, and unsupported links", () => {
    expect(document.links).toHaveLength(1);
  });

  it("preserves readable block spacing", () => {
    expect(document.text).toContain("Recruiter conversation System design round");
  });

  it("ranks an unusual candidate-process link as hiring", () => {
    expect(rankLink(document.links[0]!).classificationHint).toBe("hiring");
  });

  it("requires process content before classifying a team page as hiring", () => {
    expect(
      classifyPage({
        finalUrl: "https://example.com/team",
        title: "Our team",
        headings: ["Meet the team"],
        text: "Employees across product and support.",
      }),
    ).not.toBe("hiring");
  });
});
