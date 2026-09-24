// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ApiError } from "../lib/api";
import { validateRole } from "../lib/validation";
import { isActiveJob } from "../lib/job-status";

afterEach(() => vi.unstubAllGlobals());

describe("web API boundary", () => {
  it("accepts an empty 204 response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await api<void>("/auth/logout", { method: "POST" })).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("keeps a structured error code, details and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "KIT_INVALID",
              message: "Broken links",
              details: { field: "questions" },
            },
          }),
          { status: 422 },
        ),
      ),
    );
    await expect(api("/kits/k1")).rejects.toMatchObject({
      code: "KIT_INVALID",
      message: "Broken links",
      status: 422,
      details: { field: "questions" },
    } satisfies Partial<ApiError>);
  });
});

describe("new kit validation", () => {
  const valid = { jd: "Requirements: TypeScript", company_url: "https://example.com", days: 5 };
  it("requires a real description and safe HTTP URL", () => {
    expect(validateRole({ ...valid, jd: " " })).toContain("description");
    expect(validateRole({ ...valid, company_url: "javascript:alert(1)" })).toContain("HTTP");
    expect(validateRole({ ...valid, company_url: "https://user:pass@example.com" })).toContain(
      "HTTP",
    );
  });
  it("accepts one and 365 days, rejects fractions and overflow", () => {
    expect(validateRole({ ...valid, days: 1 })).toBeNull();
    expect(validateRole({ ...valid, days: 365 })).toBeNull();
    expect(validateRole({ ...valid, days: 1.5 })).toContain("integer");
    expect(validateRole({ ...valid, jd: "x".repeat(30_001) })).toContain("30,000");
  });
});

it("polls only while a generation or regeneration job is active", () => {
  expect(isActiveJob("queued")).toBe(true);
  expect(isActiveJob("running")).toBe(true);
  expect(isActiveJob("done")).toBe(false);
  expect(isActiveJob("failed")).toBe(false);
  expect(isActiveJob("interrupted")).toBe(false);
});
