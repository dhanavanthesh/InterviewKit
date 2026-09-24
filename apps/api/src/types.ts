import type { Kit, ProgressEvent, QuestionCategory, StructuredError } from "@interview-kit/schema";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export type KitStatus = "generating" | "ready" | "failed";
export type JobStatus = "queued" | "running" | "done" | "failed" | "interrupted";
export type JobType = "create" | "regenerate";

export interface KitRecord {
  id: string;
  ownerId: string;
  status: KitStatus;
  version: number;
  dedupeKey: string;
  input: { jd: string; companyUrl: string; days: number };
  kit: Kit | null;
  counters: { requirement: number; question: number; flashcard: number };
  regenerating: string[];
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobRecord {
  id: string;
  ownerId: string;
  kitId: string;
  type: JobType;
  section?: "company_brief" | "questions" | "schedule";
  category?: QuestionCategory;
  status: JobStatus;
  steps: ProgressEvent[];
  error: StructuredError | null;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  updatedAt: Date;
}

export interface PracticeReviewRecord {
  id: string;
  ownerId: string;
  kitId: string;
  cardId: string;
  confidence: 1 | 2 | 3 | 4;
  reviewedAt: Date;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface PipelineExecutor {
  create(
    record: KitRecord,
    onProgress: (event: ProgressEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<Kit>;
  regenerate(record: KitRecord, job: JobRecord, signal: AbortSignal): Promise<Kit>;
}
