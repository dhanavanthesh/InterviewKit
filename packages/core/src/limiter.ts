import { PipelineError } from "./errors";
import type { Clock, LlmUsage } from "./types";

interface Reservation {
  id: number;
  at: number;
  tokens: number;
}

interface Bucket {
  reservations: Reservation[];
}

export interface LimiterReservation {
  reconcile(usage: LlmUsage): void;
}

export interface RequestLimiter {
  reserve(
    model: string,
    estimatedInputTokens: number,
    maximumOutputTokens: number,
    deadlineAt: number,
    signal?: AbortSignal,
  ): Promise<LimiterReservation>;
}

export interface RateLimiterOptions {
  requestsPerMinute: number;
  tokensPerMinute: number;
  clock: Clock;
  random?: () => number;
}

export class LlmRateLimiter implements RequestLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private nextId = 1;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RateLimiterOptions) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async reserve(
    model: string,
    estimatedInputTokens: number,
    maximumOutputTokens: number,
    deadlineAt: number,
    signal?: AbortSignal,
  ): Promise<LimiterReservation> {
    const tokens = Math.max(1, estimatedInputTokens + maximumOutputTokens);
    if (tokens > this.options.tokensPerMinute) {
      throw new PipelineError(
        "TOKEN_LIMIT",
        "The request exceeds the configured token-per-minute limit.",
      );
    }
    return this.exclusive(async () => {
      const bucket = this.buckets.get(model) ?? { reservations: [] };
      this.buckets.set(model, bucket);
      for (;;) {
        if (signal?.aborted === true)
          throw new PipelineError("CANCELLED", "The LLM request was cancelled.");
        const now = this.options.clock.now();
        bucket.reservations = bucket.reservations.filter((entry) => entry.at > now - 60_000);
        const usedTokens = bucket.reservations.reduce((sum, entry) => sum + entry.tokens, 0);
        if (
          bucket.reservations.length < this.options.requestsPerMinute &&
          usedTokens + tokens <= this.options.tokensPerMinute
        ) {
          const reservation = { id: this.nextId, at: now, tokens };
          this.nextId += 1;
          bucket.reservations.push(reservation);
          return {
            reconcile: (usage) => {
              const found = bucket.reservations.find(({ id }) => id === reservation.id);
              if (found !== undefined) found.tokens = Math.max(1, usage.totalTokens);
            },
          };
        }
        const oldest = bucket.reservations[0];
        const waitMs = oldest === undefined ? 1000 : Math.max(1, oldest.at + 60_000 - now);
        if (now + waitMs >= deadlineAt) {
          throw new PipelineError(
            "DEADLINE_EXCEEDED",
            "Rate-limit wait would exceed the run deadline.",
          );
        }
        await this.options.clock.sleep(waitMs, signal);
      }
    });
  }
}

export class KitTokenBudget {
  private used = 0;

  constructor(private readonly limit: number) {}

  canReserve(tokens: number): boolean {
    return this.used + tokens <= this.limit;
  }

  record(usage: LlmUsage): void {
    this.used += usage.totalTokens;
  }

  get usage(): number {
    return this.used;
  }
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(text.length / 4));
}
