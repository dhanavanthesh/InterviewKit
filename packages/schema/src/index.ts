import { z } from "zod";

const nonBlankString = z.string().trim().min(1);
const stableId = nonBlankString;

export const requirementKindSchema = z.enum(["technical", "behavioural", "domain"]);
export const requirementPrioritySchema = z.enum(["must", "nice"]);
export const questionCategorySchema = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);
export const itemOriginSchema = z.enum(["generated", "user"]);
export const generatedBySchema = z.enum(["draft", "gap", "fallback", "user"]);

export const requirementSchema = z.object({
  id: stableId,
  text: nonBlankString,
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
  evidence: nonBlankString.optional(),
  origin: itemOriginSchema.optional(),
});

export const questionSchema = z.object({
  id: stableId,
  requirement_ids: z.array(stableId),
  category: questionCategorySchema,
  prompt: nonBlankString,
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  origin: itemOriginSchema.optional(),
  edited: z.boolean().optional(),
  pinned: z.boolean().optional(),
  generated_by: generatedBySchema.optional(),
});

export const flashcardSchema = z.object({
  id: stableId,
  front: nonBlankString,
  back: z.string(),
  requirement_ids: z.array(stableId),
  question_id: stableId.optional(),
  origin: itemOriginSchema.optional(),
  edited: z.boolean().optional(),
  pinned: z.boolean().optional(),
  generated_by: generatedBySchema.optional(),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(stableId),
  minutes: z.number().int().nonnegative(),
});

export const scheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(scheduleDaySchema),
  edited: z.boolean().optional(),
});

export const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(stableId),
  passes: z.number().int().nonnegative(),
  history: z
    .array(
      z.object({
        pass: z.number().int().nonnegative(),
        uncovered_ids: z.array(stableId),
      }),
    )
    .optional(),
});

export const warningCodeSchema = z.enum([
  "THIN_JD",
  "NO_EXPLICIT_REQUIREMENTS",
  "EXTRACTION_FALLBACK",
  "COMPANY_UNREACHABLE",
  "NO_HIRING_PAGE",
  "NO_ABOUT_CONTENT",
  "NO_PUBLIC_DISCUSSION",
  "ROBOTS_BLOCKED",
  "DEGRADED",
]);

export const warningSchema = z.object({
  code: warningCodeSchema,
  message: nonBlankString,
});

export const structuredErrorSchema = z.object({
  code: nonBlankString,
  message: nonBlankString,
  details: z.record(z.unknown()).optional(),
});

export const apiErrorResponseSchema = z.object({ error: structuredErrorSchema });

export const progressEventSchema = z.object({
  step: nonBlankString,
  status: z.enum(["running", "done", "skipped", "failed"]),
  message: z.string(),
  at: z.string().datetime({ offset: true }),
});

const sourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.string().datetime({ offset: true }),
  pages_used: z.array(z.string()),
});

const companyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  summary_edited: z.boolean().optional(),
  what_they_do_edited: z.boolean().optional(),
});

const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

const hiringProcessSchema = z.object({
  stages: z.array(z.string()),
  notes: z.string(),
  sources: z.array(z.string()),
});

const discussionSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()),
});

const researchLogEntrySchema = z.object({
  url: z.string(),
  status: z.enum(["used", "skipped", "failed", "blocked_by_robots"]),
  reason: z.string(),
});

export const kitSchema = z.object({
  source: sourceSchema,
  company_brief: companyBriefSchema,
  role: roleSchema,
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: scheduleSchema,
  coverage: coverageSchema,
  hiring_process: hiringProcessSchema.nullable().optional(),
  discussion: discussionSchema.nullable().optional(),
  research_log: z.array(researchLogEntrySchema).optional(),
  warnings: z.array(warningSchema).optional(),
  tombstones: z.record(z.array(z.string())).optional(),
});

export const batchInputCaseSchema = z.object({
  id: nonBlankString,
  jd: nonBlankString,
  company_url: z.string().regex(/^https?:\/\/\S+$/i),
  days: z.number().int().positive(),
});

export const batchInputSchema = z.array(batchInputCaseSchema);

const batchOkResultSchema = z.object({
  id: nonBlankString,
  status: z.literal("ok"),
  kit: kitSchema,
  error: z.null(),
});

const batchFailedResultSchema = z.object({
  id: nonBlankString,
  status: z.literal("failed"),
  kit: z.null(),
  error: structuredErrorSchema,
});

export const batchResultSchema = z.discriminatedUnion("status", [
  batchOkResultSchema,
  batchFailedResultSchema,
]);

export const batchOutputSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string().datetime({ offset: true }),
  kits: z.array(batchResultSchema),
});

export const createKitRequestSchema = z.object({
  jd: nonBlankString.max(30_000),
  company_url: z.string().regex(/^https?:\/\/\S+$/i),
  days: z.number().int().min(1).max(365),
  force: z.boolean().optional(),
});

export const questionStateSchema = z.object({
  origin: itemOriginSchema,
  edited: z.boolean(),
  pinned: z.boolean(),
  generated_by: generatedBySchema,
});

export type RequirementKind = z.infer<typeof requirementKindSchema>;
export type RequirementPriority = z.infer<typeof requirementPrioritySchema>;
export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Kit = z.infer<typeof kitSchema>;
export type WarningCode = z.infer<typeof warningCodeSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type StructuredError = z.infer<typeof structuredErrorSchema>;
export type ProgressEvent = z.infer<typeof progressEventSchema>;
export type BatchInputCase = z.infer<typeof batchInputCaseSchema>;
export type BatchOutput = z.infer<typeof batchOutputSchema>;
