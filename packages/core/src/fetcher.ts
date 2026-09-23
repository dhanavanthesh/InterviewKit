import { fetch as undiciFetch } from "undici";

import type { PipelineConfig } from "./types";
import { PipelineError, asPipelineError } from "./errors";
import { parseHtmlDocument } from "./html";
import type { Clock, FetchOptions, PageFetcher, RetrievedPage } from "./types";
import { createPinnedDispatcher, validateUrl, type HostResolver } from "./url-safety";

export interface FetcherDependencies {
  config: PipelineConfig;
  clock: Clock;
  random?: () => number;
  resolver?: HostResolver;
  request?: typeof undiciFetch;
}

function parseRetryAfter(value: string | null, now: number): number {
  if (value === null) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? 0 : Math.max(0, at - now);
}

function expectedContentType(contentType: string): boolean {
  return /^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(contentType);
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      size += result.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PipelineError(
          "BODY_TOO_LARGE",
          "The response exceeded the configured byte limit.",
        );
      }
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function composeSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export function createPageFetcher(dependencies: FetcherDependencies): PageFetcher {
  const request = dependencies.request ?? undiciFetch;
  const random = dependencies.random ?? Math.random;

  return {
    async fetch(value: string, options: FetchOptions = {}): Promise<RetrievedPage> {
      let current = value;
      const visited = new Set<string>();
      for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
        const validated = await validateUrl(current, {
          allowPrivateHosts: dependencies.config.allowPrivateHosts,
          ...(dependencies.resolver === undefined ? {} : { resolver: dependencies.resolver }),
        });
        if (visited.has(validated.url.href)) {
          throw new PipelineError("REDIRECT_LOOP", "The page entered a redirect loop.");
        }
        visited.add(validated.url.href);
        let response: Response | undefined;
        let lastError: PipelineError | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const timeout = composeSignal(options.signal, dependencies.config.crawlTimeoutMs);
          const dispatcher = createPinnedDispatcher(validated);
          try {
            response = (await request(validated.url, {
              method: "GET",
              redirect: "manual",
              headers: {
                accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
                "user-agent": dependencies.config.crawlUserAgent,
              },
              signal: timeout.signal,
              dispatcher,
            })) as Response;
            if (response.status !== 429 && response.status < 500) break;
            lastError = new PipelineError(
              "RETRIEVAL_TRANSIENT",
              "The server temporarily rejected the request.",
              {
                retryable: true,
                status: response.status,
              },
            );
            if (attempt < 2) {
              const retryAfter = parseRetryAfter(
                response.headers.get("retry-after"),
                dependencies.clock.now(),
              );
              const backoff = Math.max(retryAfter, 200 * 2 ** attempt + Math.floor(random() * 100));
              await dependencies.clock.sleep(backoff, options.signal);
            }
          } catch (error) {
            lastError = asPipelineError(error, "RETRIEVAL_FAILED");
            if (options.signal?.aborted === true)
              throw new PipelineError("CANCELLED", "The fetch was cancelled.");
            if (attempt < 2) await dependencies.clock.sleep(200 * 2 ** attempt, options.signal);
          } finally {
            timeout.cleanup();
            if (response === undefined || response.status === 429 || response.status >= 500) {
              await dispatcher.close();
            } else {
              void dispatcher.close();
            }
          }
        }
        if (response === undefined || response.status === 429 || response.status >= 500) {
          throw (
            lastError ?? new PipelineError("RETRIEVAL_FAILED", "The page could not be retrieved.")
          );
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location === null)
            throw new PipelineError("REDIRECT_INVALID", "The redirect has no destination.");
          if (redirectCount === 5)
            throw new PipelineError("TOO_MANY_REDIRECTS", "The page redirected too many times.");
          current = new URL(location, validated.url).href;
          await options.beforeRedirect?.(current);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new PipelineError("HTTP_STATUS", `The page returned HTTP ${response.status}.`, {
            status: response.status,
          });
        }
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > dependencies.config.crawlMaxBytes) {
          throw new PipelineError(
            "BODY_TOO_LARGE",
            "The response exceeded the configured byte limit.",
          );
        }
        const bytes = await readBounded(response, dependencies.config.crawlMaxBytes);
        const body = new TextDecoder().decode(bytes);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!expectedContentType(contentType)) {
          const looksHtml =
            contentType.length === 0 && /^\s*(?:<!doctype html|<html|<head|<body)/i.test(body);
          if (!looksHtml)
            throw new PipelineError(
              "CONTENT_TYPE_UNSUPPORTED",
              "The response is not readable page text.",
            );
        }
        const headers = Object.fromEntries(response.headers.entries());
        return parseHtmlDocument(
          body,
          value,
          validated.url.href,
          response.status,
          contentType || "text/html",
          headers,
        );
      }
      throw new PipelineError("TOO_MANY_REDIRECTS", "The page redirected too many times.");
    },
  };
}
