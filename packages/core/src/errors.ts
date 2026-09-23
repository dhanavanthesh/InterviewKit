import type { PipelineErrorShape } from "./types";

export class PipelineError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(code: string, message: string, options?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
  }

  toJSON(): PipelineErrorShape {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function asPipelineError(error: unknown, fallbackCode = "INTERNAL"): PipelineError {
  if (error instanceof PipelineError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new PipelineError("CANCELLED", "The operation was cancelled.");
  }
  return new PipelineError(fallbackCode, "The operation could not be completed.");
}
