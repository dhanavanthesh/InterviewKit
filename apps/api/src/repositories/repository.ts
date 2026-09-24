import { randomUUID } from "node:crypto";

import type { Kit, ProgressEvent, StructuredError } from "@interview-kit/schema";

import type { JobRecord, JobStatus, KitRecord, PracticeReviewRecord, UserRecord } from "../types";

export interface Repositories {
  users: {
    create(email: string, passwordHash: string): Promise<UserRecord>;
    findByEmail(email: string): Promise<UserRecord | null>;
    findById(id: string): Promise<UserRecord | null>;
    incrementTokenVersion(id: string): Promise<void>;
  };
  kits: {
    create(input: Omit<KitRecord, "id" | "createdAt" | "updatedAt">): Promise<KitRecord>;
    findOwned(ownerId: string, id: string): Promise<KitRecord | null>;
    findDuplicate(ownerId: string, dedupeKey: string): Promise<KitRecord | null>;
    listOwned(ownerId: string, limit: number): Promise<KitRecord[]>;
    compareAndSwap(ownerId: string, id: string, version: number, next: KitRecord): Promise<boolean>;
    deleteOwned(ownerId: string, id: string): Promise<boolean>;
    setGenerationResult(ownerId: string, id: string, kit: Kit): Promise<boolean>;
    setStatus(ownerId: string, id: string, status: KitRecord["status"]): Promise<boolean>;
    claimSection(ownerId: string, id: string, section: string): Promise<boolean>;
    releaseSection(ownerId: string, id: string, section: string): Promise<void>;
  };
  jobs: {
    create(input: Omit<JobRecord, "id" | "createdAt" | "updatedAt">): Promise<JobRecord>;
    findOwned(ownerId: string, id: string): Promise<JobRecord | null>;
    findLatestForKit(ownerId: string, kitId: string): Promise<JobRecord | null>;
    transition(
      ownerId: string,
      id: string,
      from: readonly JobStatus[],
      to: JobStatus,
    ): Promise<boolean>;
    requeue(ownerId: string, id: string): Promise<boolean>;
    addProgress(ownerId: string, id: string, event: ProgressEvent): Promise<void>;
    finish(
      ownerId: string,
      id: string,
      status: "done" | "failed",
      error: StructuredError | null,
    ): Promise<void>;
    interruptStale(): Promise<number>;
    listInterruptedRegenerations(): Promise<JobRecord[]>;
    deleteForKit(ownerId: string, kitId: string): Promise<void>;
  };
  reviews: {
    create(input: Omit<PracticeReviewRecord, "id">): Promise<PracticeReviewRecord>;
    listOwned(ownerId: string, kitId: string): Promise<PracticeReviewRecord[]>;
    deleteForCard(ownerId: string, kitId: string, cardId: string): Promise<void>;
    deleteForKit(ownerId: string, kitId: string): Promise<void>;
  };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryRepositories implements Repositories {
  private readonly userRecords = new Map<string, UserRecord>();
  private readonly kitRecords = new Map<string, KitRecord>();
  private readonly jobRecords = new Map<string, JobRecord>();
  private readonly reviewRecords = new Map<string, PracticeReviewRecord>();

  readonly users: Repositories["users"] = {
    create: (email, passwordHash) => {
      if ([...this.userRecords.values()].some((user) => user.email === email)) {
        return Promise.reject(new Error("DUPLICATE_EMAIL"));
      }
      const now = new Date();
      const record: UserRecord = {
        id: randomUUID(),
        email,
        passwordHash,
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.userRecords.set(record.id, record);
      return Promise.resolve(copy(record));
    },
    findByEmail: (email) =>
      Promise.resolve(
        copy([...this.userRecords.values()].find((user) => user.email === email) ?? null),
      ),
    findById: (id) => Promise.resolve(copy(this.userRecords.get(id) ?? null)),
    incrementTokenVersion: (id) => {
      const user = this.userRecords.get(id);
      if (user !== undefined) {
        user.tokenVersion += 1;
        user.updatedAt = new Date();
      }
      return Promise.resolve();
    },
  };

  readonly kits: Repositories["kits"] = {
    create: (input) => {
      const duplicate = [...this.kitRecords.values()].some(
        (record) =>
          !record.deleted &&
          record.ownerId === input.ownerId &&
          record.dedupeKey === input.dedupeKey,
      );
      if (duplicate) return Promise.reject(new Error("DUPLICATE_KIT"));
      const now = new Date();
      const record: KitRecord = {
        ...copy(input),
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.kitRecords.set(record.id, record);
      return Promise.resolve(copy(record));
    },
    findOwned: (ownerId, id) => {
      const record = this.kitRecords.get(id);
      return Promise.resolve(copy(record?.ownerId === ownerId && !record.deleted ? record : null));
    },
    findDuplicate: (ownerId, dedupeKey) =>
      Promise.resolve(
        copy(
          [...this.kitRecords.values()].find(
            (record) =>
              record.ownerId === ownerId && record.dedupeKey === dedupeKey && !record.deleted,
          ) ?? null,
        ),
      ),
    listOwned: (ownerId, limit) =>
      Promise.resolve(
        copy(
          [...this.kitRecords.values()]
            .filter((record) => record.ownerId === ownerId && !record.deleted)
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
            .slice(0, limit),
        ),
      ),
    compareAndSwap: (ownerId, id, version, next) => {
      const current = this.kitRecords.get(id);
      if (
        current === undefined ||
        current.deleted ||
        current.ownerId !== ownerId ||
        current.version !== version
      ) {
        return Promise.resolve(false);
      }
      this.kitRecords.set(id, {
        ...copy(next),
        regenerating: copy(current.regenerating),
        version: version + 1,
        updatedAt: new Date(),
      });
      return Promise.resolve(true);
    },
    deleteOwned: (ownerId, id) => {
      const record = this.kitRecords.get(id);
      if (record === undefined || record.ownerId !== ownerId || record.deleted)
        return Promise.resolve(false);
      record.deleted = true;
      record.version += 1;
      record.updatedAt = new Date();
      return Promise.resolve(true);
    },
    setGenerationResult: (ownerId, id, kit) => {
      const record = this.kitRecords.get(id);
      if (record === undefined || record.ownerId !== ownerId || record.deleted)
        return Promise.resolve(false);
      record.kit = copy(kit);
      record.status = "ready";
      record.version += 1;
      record.updatedAt = new Date();
      return Promise.resolve(true);
    },
    setStatus: (ownerId, id, status) => {
      const record = this.kitRecords.get(id);
      if (record === undefined || record.ownerId !== ownerId || record.deleted)
        return Promise.resolve(false);
      record.status = status;
      record.updatedAt = new Date();
      return Promise.resolve(true);
    },
    claimSection: (ownerId, id, section) => {
      const record = this.kitRecords.get(id);
      if (
        record === undefined ||
        record.ownerId !== ownerId ||
        record.deleted ||
        record.regenerating.includes(section)
      ) {
        return Promise.resolve(false);
      }
      record.regenerating.push(section);
      return Promise.resolve(true);
    },
    releaseSection: (ownerId, id, section) => {
      const record = this.kitRecords.get(id);
      if (record?.ownerId === ownerId)
        record.regenerating = record.regenerating.filter((item) => item !== section);
      return Promise.resolve();
    },
  };

  readonly jobs: Repositories["jobs"] = {
    create: (input) => {
      const now = new Date();
      const record: JobRecord = {
        ...copy(input),
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.jobRecords.set(record.id, record);
      return Promise.resolve(copy(record));
    },
    findOwned: (ownerId, id) => {
      const record = this.jobRecords.get(id);
      return Promise.resolve(copy(record?.ownerId === ownerId ? record : null));
    },
    findLatestForKit: (ownerId, kitId) =>
      Promise.resolve(
        copy(
          [...this.jobRecords.values()]
            .filter((record) => record.ownerId === ownerId && record.kitId === kitId)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null,
        ),
      ),
    transition: (ownerId, id, from, to) => {
      const record = this.jobRecords.get(id);
      if (record === undefined || record.ownerId !== ownerId || !from.includes(record.status))
        return Promise.resolve(false);
      record.status = to;
      record.updatedAt = new Date();
      if (to === "running") record.startedAt = new Date();
      return Promise.resolve(true);
    },
    requeue: (ownerId, id) => {
      const record = this.jobRecords.get(id);
      if (
        record === undefined ||
        record.ownerId !== ownerId ||
        !["failed", "interrupted"].includes(record.status)
      )
        return Promise.resolve(false);
      record.status = "queued";
      record.error = null;
      record.steps = [];
      delete record.startedAt;
      delete record.finishedAt;
      record.updatedAt = new Date();
      return Promise.resolve(true);
    },
    addProgress: (ownerId, id, event) => {
      const record = this.jobRecords.get(id);
      if (record?.ownerId === ownerId) {
        const index = record.steps.findIndex((step) => step.step === event.step);
        if (index >= 0) record.steps[index] = copy(event);
        else record.steps.push(copy(event));
        record.updatedAt = new Date();
      }
      return Promise.resolve();
    },
    finish: (ownerId, id, status, error) => {
      const record = this.jobRecords.get(id);
      if (record?.ownerId === ownerId) {
        record.status = status;
        record.error = copy(error);
        record.finishedAt = new Date();
        record.updatedAt = new Date();
      }
      return Promise.resolve();
    },
    interruptStale: () => {
      let count = 0;
      for (const record of this.jobRecords.values()) {
        if (record.status === "queued" || record.status === "running") {
          record.status = "interrupted";
          record.finishedAt = new Date();
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    listInterruptedRegenerations: () =>
      Promise.resolve(
        copy(
          [...this.jobRecords.values()].filter(
            (record) => record.type === "regenerate" && record.status === "interrupted",
          ),
        ),
      ),
    deleteForKit: (ownerId, kitId) => {
      for (const [id, record] of this.jobRecords)
        if (record.ownerId === ownerId && record.kitId === kitId) this.jobRecords.delete(id);
      return Promise.resolve();
    },
  };

  readonly reviews: Repositories["reviews"] = {
    create: (input) => {
      const record = { ...copy(input), id: randomUUID() };
      this.reviewRecords.set(record.id, record);
      return Promise.resolve(copy(record));
    },
    listOwned: (ownerId, kitId) =>
      Promise.resolve(
        copy(
          [...this.reviewRecords.values()].filter(
            (item) => item.ownerId === ownerId && item.kitId === kitId,
          ),
        ),
      ),
    deleteForCard: (ownerId, kitId, cardId) => {
      for (const [id, item] of this.reviewRecords)
        if (item.ownerId === ownerId && item.kitId === kitId && item.cardId === cardId)
          this.reviewRecords.delete(id);
      return Promise.resolve();
    },
    deleteForKit: (ownerId, kitId) => {
      for (const [id, item] of this.reviewRecords)
        if (item.ownerId === ownerId && item.kitId === kitId) this.reviewRecords.delete(id);
      return Promise.resolve();
    },
  };
}
