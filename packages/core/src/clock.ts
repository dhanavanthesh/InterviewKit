import type { Clock, DeadlineState } from "./types";

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: async (ms, signal) => {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal?.aborted === true) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  },
};

export function createDeadline(clock: Clock, durationMs: number): DeadlineState {
  const expiresAt = clock.now() + durationMs;
  return { expiresAt, remainingMs: () => Math.max(0, expiresAt - clock.now()) };
}
