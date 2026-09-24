import { mergeCompanyBrief, mergeQuestionCategory } from "@interview-kit/logic";
import type { Kit, QuestionCategory, StructuredError } from "@interview-kit/schema";

import { ApiError } from "../errors";
import type { Repositories } from "../repositories/repository";
import type { JobRecord, KitRecord, PipelineExecutor } from "../types";
import { validateGeneratedKit } from "./kit-validation";
import { mutateOwnedKit, requireReadyKit } from "./mutation";

function safeError(error: unknown): StructuredError {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  return { code: "GENERATION_FAILED", message: "Generation could not be completed." };
}

function maxCounter(ids: readonly string[], prefix: string): number {
  return Math.max(
    0,
    ...ids.map((id) => Number(new RegExp(`^${prefix}(\\d+)$`).exec(id)?.[1] ?? 0)),
  );
}

function generatedCounters(kit: Kit): KitRecord["counters"] {
  return {
    requirement: maxCounter(
      kit.role.requirements.map(({ id }) => id),
      "r",
    ),
    question: maxCounter(
      kit.questions.map(({ id }) => id),
      "q",
    ),
    flashcard: maxCounter(
      kit.flashcards.map(({ id }) => id),
      "f",
    ),
  };
}

export class JobRunner {
  private readonly queue: JobRecord[] = [];
  private readonly controllers = new Map<string, { controller: AbortController; kitId: string }>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly repositories: Repositories,
    private readonly executor: PipelineExecutor,
    private readonly concurrency = 2,
  ) {}

  enqueue(job: JobRecord): void {
    this.queue.push(job);
    this.pump();
  }

  async recover(): Promise<number> {
    const count = await this.repositories.jobs.interruptStale();
    for (const job of await this.repositories.jobs.listInterruptedRegenerations()) {
      if (job.section !== undefined)
        await this.repositories.kits.releaseSection(
          job.ownerId,
          job.kitId,
          sectionKey(job.section, job.category),
        );
    }
    return count;
  }

  async retry(ownerId: string, jobId: string): Promise<JobRecord> {
    const job = await this.repositories.jobs.findOwned(ownerId, jobId);
    if (job === null) throw new ApiError("NOT_FOUND", "The job was not found.");
    if (job.status !== "failed" && job.status !== "interrupted")
      throw new ApiError("SECTION_BUSY", "Only failed or interrupted jobs can be retried.");
    const key = job.section === undefined ? undefined : sectionKey(job.section, job.category);
    if (key !== undefined) {
      if ((await this.repositories.kits.findOwned(ownerId, job.kitId)) === null)
        throw new ApiError("NOT_FOUND", "The kit was not found.");
      if (!(await this.repositories.kits.claimSection(ownerId, job.kitId, key)))
        throw new ApiError("SECTION_BUSY", "This section is already regenerating.");
    }
    let requeued = false;
    try {
      requeued = await this.repositories.jobs.requeue(ownerId, jobId);
      if (!requeued)
        throw new ApiError("SECTION_BUSY", "Only failed or interrupted jobs can be retried.");
      if (job.type === "create")
        await this.repositories.kits.setStatus(ownerId, job.kitId, "generating");
      const queued = { ...job, status: "queued" as const, error: null, steps: [] };
      delete queued.startedAt;
      delete queued.finishedAt;
      this.enqueue(queued);
      return queued;
    } catch (error) {
      try {
        if (requeued)
          await this.repositories.jobs.finish(ownerId, jobId, "failed", safeError(error));
      } finally {
        if (key !== undefined) await this.repositories.kits.releaseSection(ownerId, job.kitId, key);
      }
      throw error;
    }
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  cancelKit(kitId: string): void {
    for (const entry of this.controllers.values())
      if (entry.kitId === kitId) entry.controller.abort();
    const remaining = this.queue.filter((job) => job.kitId !== kitId);
    this.queue.splice(0, this.queue.length, ...remaining);
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active += 1;
      void this.run(job).finally(() => {
        this.active -= 1;
        if (this.active === 0 && this.queue.length === 0)
          this.waiters.splice(0).forEach((resolve) => resolve());
        this.pump();
      });
    }
  }

  private async run(job: JobRecord): Promise<void> {
    const claimed = await this.repositories.jobs.transition(
      job.ownerId,
      job.id,
      ["queued"],
      "running",
    );
    if (!claimed) return;
    const controller = new AbortController();
    this.controllers.set(job.id, { controller, kitId: job.kitId });
    try {
      if (job.type === "create") await this.runCreate(job, controller.signal);
      else await this.runRegeneration(job, controller.signal);
      await this.repositories.jobs.finish(job.ownerId, job.id, "done", null);
    } catch (error) {
      if (job.type === "create")
        await this.repositories.kits.setStatus(job.ownerId, job.kitId, "failed");
      await this.repositories.jobs.finish(job.ownerId, job.id, "failed", safeError(error));
    } finally {
      if (job.section !== undefined)
        await this.repositories.kits.releaseSection(
          job.ownerId,
          job.kitId,
          sectionKey(job.section, job.category),
        );
      this.controllers.delete(job.id);
    }
  }

  private async runCreate(job: JobRecord, signal: AbortSignal): Promise<void> {
    const record = await this.repositories.kits.findOwned(job.ownerId, job.kitId);
    if (record === null) return;
    const generated = await this.executor.create(
      record,
      (event) => this.repositories.jobs.addProgress(job.ownerId, job.id, event),
      signal,
    );
    const kit = validateGeneratedKit(generated, record.input.days);
    const saved = await this.repositories.kits.setGenerationResult(job.ownerId, job.kitId, kit);
    if (!saved)
      throw new ApiError("NOT_FOUND", "The kit was deleted while generation was running.");
    await mutateOwnedKit(this.repositories, job.ownerId, job.kitId, (latest) => ({
      ...latest,
      counters: generatedCounters(kit),
    }));
  }

  private async runRegeneration(job: JobRecord, signal: AbortSignal): Promise<void> {
    const snapshot = await requireReadyKit(this.repositories, job.ownerId, job.kitId);
    const generated = await this.executor.regenerate(snapshot, job, signal);
    await mutateOwnedKit(this.repositories, job.ownerId, job.kitId, (latest) => ({
      ...latest,
      kit: applyRegeneratedSection(latest.kit, generated, job),
      counters: {
        requirement: Math.max(
          latest.counters.requirement,
          generatedCounters(generated).requirement,
        ),
        question: Math.max(latest.counters.question, generatedCounters(generated).question),
        flashcard: Math.max(latest.counters.flashcard, generatedCounters(generated).flashcard),
      },
    }));
  }
}

export function sectionKey(section: string, category?: QuestionCategory): string {
  return section === "questions" && category !== undefined ? `questions:${category}` : section;
}

function applyRegeneratedSection(latest: Kit, generated: Kit, job: JobRecord): Kit {
  if (job.section === "company_brief") {
    const editable = (brief: Kit["company_brief"]) => ({
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      sources: brief.sources,
      ...(brief.summary_edited === undefined ? {} : { summary_edited: brief.summary_edited }),
      ...(brief.what_they_do_edited === undefined
        ? {}
        : { what_they_do_edited: brief.what_they_do_edited }),
    });
    return {
      ...latest,
      company_brief: mergeCompanyBrief(
        editable(latest.company_brief),
        editable(generated.company_brief),
      ),
    };
  }
  if (job.section === "questions" && job.category !== undefined) {
    const result = mergeQuestionCategory({
      existingQuestions: latest.questions,
      category: job.category,
      generatedQuestions: generated.questions.filter(({ category }) => category === job.category),
      tombstones: latest.tombstones ?? {},
      nextQuestionNumber:
        maxCounter(
          latest.questions.map(({ id }) => id),
          "q",
        ) + 1,
    });
    const questionIds = new Set(result.questions.map(({ id }) => id));
    const flashcards = latest.flashcards.map((card) => {
      if (card.question_id === undefined || questionIds.has(card.question_id)) return card;
      const unlinked = { ...card };
      delete unlinked.question_id;
      return unlinked;
    });
    return { ...latest, questions: result.questions, flashcards };
  }
  return { ...latest, schedule: generated.schedule };
}
