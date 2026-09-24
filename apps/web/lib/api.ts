import type { Kit, ProgressEvent, QuestionCategory, StructuredError } from "@interview-kit/schema";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: StructuredError } | null)?.error;
    if (response.status === 401 && !["/auth/login", "/auth/register", "/auth/me"].includes(path)) {
      if (typeof window !== "undefined") {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?reason=session-expired&next=${encodeURIComponent(next)}`);
      }
    }
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? "Something went wrong.",
      response.status,
      error?.details ?? {},
    );
  }
  return body as T;
}

export function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export interface User {
  id: string;
  email: string;
}
export interface KitListItem {
  id: string;
  company: string;
  role: string;
  status: "generating" | "ready" | "failed";
  days: number;
  updated_at: string;
}
export interface KitDetail {
  id: string;
  status: KitListItem["status"];
  version: number;
  kit: Kit | null;
}
export interface KitCreation {
  kit_id: string;
  job_id: string | null;
  status: KitListItem["status"];
  existing: boolean;
}
export interface Job {
  id: string;
  kit_id: string;
  status: "queued" | "running" | "done" | "failed" | "interrupted";
  steps: ProgressEvent[];
  error: StructuredError | null;
}
export interface BatchRow {
  row: number;
  kit_id: string | null;
  job_id: string | null;
  error: StructuredError | null;
}
export interface Coverage {
  uncovered_requirement_ids: string[];
  must_uncovered_requirement_ids: string[];
  nice_uncovered_requirement_ids: string[];
  passes: number;
  history: { pass: number; uncovered_ids: string[] }[];
}
export interface PracticeSession {
  card_ids: string[];
  cards: Kit["flashcards"];
}
export interface PracticeProgress {
  coveredCardIds: string[];
  uncoveredCardIds: string[];
  coveredCount: number;
  totalCount: number;
  coverageRatio: number;
  requirement_readiness: Record<string, boolean>;
}
export type RegenerateRequest =
  | { section: "company_brief" }
  | { section: "questions"; category: QuestionCategory }
  | { section: "schedule"; confirm?: boolean };
