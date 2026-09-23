import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDiscussionSearcher, filterDiscussionHits } from "../src/discussion";
import { LlmRateLimiter, type RequestLimiter } from "../src/limiter";
import { createGroqClient, FixtureLlmClient } from "../src/llm";
import type { Clock } from "../src/types";

function fakeClock(): Clock & { time: number } {
  return {
    time: 0,
    now() {
      return this.time;
    },
    sleep(ms, signal) {
      if (signal?.aborted === true) throw new DOMException("aborted", "AbortError");
      this.time += ms;
      return Promise.resolve();
    },
  };
}

describe("public discussion", () => {
  it("accepts relevant exact-company results and rejects generic-name noise", () => {
    const hits = filterDiscussionHits(
      [
        {
          title: "Acme interview process",
          comment_text: "The recruiter was helpful",
          url: "https://news.ycombinator.com/item?id=1",
        },
        {
          title: "An acme of design",
          comment_text: "No company hiring discussion",
          url: "https://news.ycombinator.com/item?id=2",
        },
        {
          title: "Other company interview",
          comment_text: "Acme-free discussion",
          url: "https://news.ycombinator.com/item?id=3",
        },
      ],
      "Acme",
      "https://acme.example",
    );
    expect(hits.map(({ url }) => url)).toEqual(["https://news.ycombinator.com/item?id=1"]);
  });

  it("returns no results and a nonfatal failure on network errors", async () => {
    const searcher = createDiscussionSearcher({
      clock: fakeClock(),
      request: vi.fn(() => Promise.reject(new Error("offline"))),
    });
    await expect(searcher.search("Acme", "https://acme.example")).resolves.toEqual({
      hits: [],
      failed: true,
    });
  });

  it("caches successful searches per company", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const searcher = createDiscussionSearcher({ clock: fakeClock(), request });
    await searcher.search("Acme", "https://acme.example");
    await searcher.search("Acme", "https://acme.example");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("shared LLM limiter", () => {
  it("waits for RPM capacity using an injected clock", async () => {
    const clock = fakeClock();
    const limiter = new LlmRateLimiter({ requestsPerMinute: 1, tokensPerMinute: 1000, clock });
    await limiter.reserve("model", 10, 10, 200_000);
    await limiter.reserve("model", 10, 10, 200_000);
    expect(clock.time).toBe(60_000);
  });

  it("reconciles reserved tokens with actual usage", async () => {
    const clock = fakeClock();
    const limiter = new LlmRateLimiter({ requestsPerMinute: 5, tokensPerMinute: 100, clock });
    const first = await limiter.reserve("model", 20, 70, 200_000);
    first.reconcile({ inputTokens: 5, outputTokens: 5, totalTokens: 10 });
    await limiter.reserve("model", 20, 60, 200_000);
    expect(clock.time).toBe(0);
  });

  it("fails when a required wait exceeds the deadline", async () => {
    const clock = fakeClock();
    const limiter = new LlmRateLimiter({ requestsPerMinute: 1, tokensPerMinute: 1000, clock });
    await limiter.reserve("model", 10, 10, 200_000);
    await expect(limiter.reserve("model", 10, 10, 30_000)).rejects.toMatchObject({
      code: "DEADLINE_EXCEEDED",
    });
  });
});

describe("LLM clients", () => {
  const schema = z.object({ value: z.string() });

  it("records deterministic fixture calls", async () => {
    const fixture = new FixtureLlmClient(() => ({ value: "ok" }));
    await expect(
      fixture.complete({
        model: "fixture",
        system: "Return a value",
        data: { requirement_ids: ["r1"] },
        schema,
        schemaName: "value",
        maxCompletionTokens: 100,
        category: "technical",
      }),
    ).resolves.toMatchObject({ value: { value: "ok" } });
    expect(fixture.calls[0]?.category).toBe("technical");
  });

  it("uses strict structured output and validates a successful response", async () => {
    const clock = fakeClock();
    const request = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === "string" ? init.body : "{}";
      const body = JSON.parse(bodyText) as {
        response_format: { json_schema: { strict: boolean } };
      };
      expect(body.response_format.json_schema.strict).toBe(true);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ value: "ok" }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    const limiter = new LlmRateLimiter({ requestsPerMinute: 30, tokensPerMinute: 10_000, clock });
    const client = createGroqClient({
      apiKey: "not-a-real-key",
      limiter,
      clock,
      deadlineAt: 100_000,
      request,
    });
    const response = await client.complete({
      model: "openai/gpt-oss-20b",
      system: "Return a value",
      data: { text: "untrusted" },
      schema,
      schemaName: "value",
      maxCompletionTokens: 100,
    });
    expect(response.value.value).toBe("ok");
    expect(response.usage.totalTokens).toBe(12);
  });

  it("repairs one invalid structured response", async () => {
    const clock = fakeClock();
    let call = 0;
    const request = vi.fn(() => {
      call += 1;
      const content =
        call === 1 ? JSON.stringify({ wrong: true }) : JSON.stringify({ value: "fixed" });
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 2 } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    });
    const limiter = new LlmRateLimiter({ requestsPerMinute: 30, tokensPerMinute: 10_000, clock });
    const client = createGroqClient({
      apiKey: "secret-value",
      limiter,
      clock,
      deadlineAt: 100_000,
      request,
    });
    await expect(
      client.complete({
        model: "model",
        system: "Return",
        data: {},
        schema,
        schemaName: "value",
        maxCompletionTokens: 100,
      }),
    ).resolves.toMatchObject({ value: { value: "fixed" } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reserves and reconciles limiter capacity for every provider request", async () => {
    const clock = fakeClock();
    const inner = new LlmRateLimiter({ requestsPerMinute: 30, tokensPerMinute: 10_000, clock });
    const reconciled: number[] = [];
    let reservations = 0;
    const limiter: RequestLimiter = {
      async reserve(...args) {
        reservations += 1;
        const reservation = await inner.reserve(...args);
        return {
          reconcile(usage) {
            reconciled.push(usage.totalTokens);
            reservation.reconcile(usage);
          },
        };
      },
    };
    let call = 0;
    const request = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve(new Response("", { status: 429 }));
      const content =
        call === 2 ? JSON.stringify({ wrong: true }) : JSON.stringify({ value: "fixed" });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { total_tokens: 40 + call },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    const client = createGroqClient({
      apiKey: "secret-value",
      limiter,
      clock,
      deadlineAt: 100_000,
      request,
      random: () => 0,
    });
    const response = await client.complete({
      model: "model",
      system: "Return",
      data: {},
      schema,
      schemaName: "value",
      maxCompletionTokens: 100,
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(reservations).toBe(3);
    expect(reconciled).toEqual([1, 42, 43]);
    expect(response.usage.totalTokens).toBe(85);
  });

  it("does not expose the API key in provider errors", async () => {
    const clock = fakeClock();
    const limiter = new LlmRateLimiter({ requestsPerMinute: 30, tokensPerMinute: 10_000, clock });
    const client = createGroqClient({
      apiKey: "super-secret-value",
      limiter,
      clock,
      deadlineAt: 100_000,
      request: () => Promise.resolve(new Response("super-secret-value invalid", { status: 401 })),
    });
    await expect(
      client.complete({
        model: "model",
        system: "Return",
        data: {},
        schema,
        schemaName: "value",
        maxCompletionTokens: 100,
      }),
    ).rejects.not.toThrow("super-secret-value");
  });
});
