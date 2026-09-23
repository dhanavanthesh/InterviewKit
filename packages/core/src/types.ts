import type { Kit, ProgressEvent, QuestionCategory, Warning } from "@interview-kit/schema";
import type { z } from "zod";

export interface PipelineConfig {
  groqApiKey?: string;
  mainModel: string;
  lightModel: string;
  llmRpm: number;
  llmTpm: number;
  kitTokenBudget: number;
  maxCoveragePasses: number;
  allowPrivateHosts: boolean;
  crawlMaxPages: number;
  crawlTimeoutMs: number;
  crawlMaxBytes: number;
  researchTimeoutMs: number;
  crawlUserAgent: string;
  evalConcurrency: number;
  evalRunDeadlineMs: number;
}

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface DeadlineState {
  expiresAt: number;
  remainingMs(): number;
}

export interface ExtractedLink {
  url: string;
  anchorText: string;
  sourceUrl: string;
}

export type PageClassification = "homepage" | "about" | "hiring" | "engineering" | "other";

export interface RetrievedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  title: string;
  siteName: string;
  headings: string[];
  text: string;
  links: ExtractedLink[];
  classification: PageClassification;
  noindex: boolean;
  nofollow: boolean;
}

export interface RankedLink extends ExtractedLink {
  score: number;
  classificationHint: PageClassification;
}

export interface ResearchLogEntry {
  url: string;
  status: "used" | "skipped" | "failed" | "blocked_by_robots";
  reason: string;
}

export interface CrawlResult {
  pages: RetrievedPage[];
  log: ResearchLogEntry[];
  companyName: string;
  warnings: Warning[];
}

export interface FetchOptions {
  signal?: AbortSignal;
  skipRobots?: boolean;
  // Called with each redirect destination before it is requested; throw to refuse the redirect.
  beforeRedirect?: (url: string) => Promise<void>;
}

export interface PageFetcher {
  fetch(url: string, options?: FetchOptions): Promise<RetrievedPage>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmRequest<T> {
  model: string;
  system: string;
  data: unknown;
  schema: z.ZodType<T>;
  schemaName: string;
  maxCompletionTokens: number;
  signal?: AbortSignal;
  optional?: boolean;
  category?: QuestionCategory | "gap" | "extraction" | "brief" | "hiring" | "flashcards";
}

export interface LlmResponse<T> {
  value: T;
  usage: LlmUsage;
}

export interface LlmClient {
  complete<T>(request: LlmRequest<T>): Promise<LlmResponse<T>>;
}

export interface PipelineCheckpoint {
  key: string;
  value: unknown;
  savedAt: string;
}

export interface PipelineStore {
  save(checkpoint: PipelineCheckpoint): Promise<void>;
  load(key: string): Promise<PipelineCheckpoint | undefined>;
}

export interface DiscussionHit {
  title: string;
  text: string;
  url: string;
}

export interface DiscussionResult {
  hits: DiscussionHit[];
  failed: boolean;
}

export interface DiscussionSearcher {
  search(companyName: string, companyUrl: string, signal?: AbortSignal): Promise<DiscussionResult>;
}

export interface PipelineDependencies {
  llm?: LlmClient;
  fetcher: PageFetcher;
  store: PipelineStore;
  discussion: DiscussionSearcher;
  onProgress?: (event: ProgressEvent) => void | Promise<void>;
  clock: Clock;
  config: PipelineConfig;
  signal?: AbortSignal;
}

export interface PipelineResult {
  kit: Kit;
  usage: LlmUsage;
  retries: number;
  durationMs: number;
}

export interface PipelineWarning {
  code: Warning["code"];
  message: string;
}

export interface PipelineErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}
