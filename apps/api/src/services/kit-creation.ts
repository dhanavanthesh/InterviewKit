import { createHash, randomUUID } from "node:crypto";

import type { Repositories } from "../repositories/repository";
import type { JobRecord, KitRecord } from "../types";
import type { JobRunner } from "./job-runner";

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
  force: boolean;
}

export function kitDedupeKey(ownerId: string, input: Omit<CreateKitInput, "force">): string {
  const normalizedJd = input.jd.normalize("NFKC").replace(/\s+/g, " ").trim();
  const url = new URL(input.companyUrl);
  url.hash = "";
  const normalizedUrl = url.toString().replace(/\/$/, "").toLowerCase();
  return createHash("sha256")
    .update(`${ownerId}\n${normalizedJd}\n${normalizedUrl}\n${input.days}`)
    .digest("hex");
}

export interface CreationResult {
  kit: KitRecord;
  job: JobRecord | null;
  existing: boolean;
}

export async function createKit(
  repositories: Repositories,
  runner: JobRunner,
  ownerId: string,
  input: CreateKitInput,
): Promise<CreationResult> {
  const baseKey = kitDedupeKey(ownerId, input);
  if (!input.force) {
    const duplicate = await repositories.kits.findDuplicate(ownerId, baseKey);
    if (duplicate !== null) {
      const existingJob = await repositories.jobs.findLatestForKit(ownerId, duplicate.id);
      if (duplicate.status === "failed" && existingJob !== null) {
        return { kit: duplicate, job: await runner.retry(ownerId, existingJob.id), existing: true };
      }
      return {
        kit: duplicate,
        job: existingJob,
        existing: true,
      };
    }
  }
  const dedupeKey = input.force ? `${baseKey}:${randomUUID()}` : baseKey;
  let kit: KitRecord;
  try {
    kit = await repositories.kits.create({
      ownerId,
      status: "generating",
      version: 0,
      dedupeKey,
      input: { jd: input.jd, companyUrl: input.companyUrl, days: input.days },
      kit: null,
      counters: { requirement: 0, question: 0, flashcard: 0 },
      regenerating: [],
      deleted: false,
    });
  } catch (error) {
    if (!input.force) {
      const duplicate = await repositories.kits.findDuplicate(ownerId, baseKey);
      if (duplicate !== null) {
        return {
          kit: duplicate,
          job: await repositories.jobs.findLatestForKit(ownerId, duplicate.id),
          existing: true,
        };
      }
    }
    throw error;
  }
  const job = await repositories.jobs.create({
    ownerId,
    kitId: kit.id,
    type: "create",
    status: "queued",
    steps: [],
    error: null,
  });
  runner.enqueue(job);
  return { kit, job, existing: false };
}
