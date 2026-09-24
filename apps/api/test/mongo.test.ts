import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, connectDatabase } from "../src/db";
import { createApp } from "../src/app";
import { parseApiEnvironment } from "../src/env";
import { KitModel, UserModel } from "../src/models/index";
import { createMongooseRepositories } from "../src/repositories/mongoose";
import { JobRunner } from "../src/services/job-runner";
import { FixtureExecutor, makeKit } from "./support";

describe("MongoDB repositories", () => {
  let server: MongoMemoryServer | undefined;
  const repositories = createMongooseRepositories();

  beforeAll(async () => {
    server = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
    await connectDatabase(server.getUri());
    await Promise.all([UserModel.init(), KitModel.init()]);
  }, 360_000);

  afterAll(async () => {
    await closeDatabase();
    await server?.stop();
  });

  it("stores actual dates and keeps kit, job, and review queries owner scoped", async () => {
    const owner = await repositories.users.create("owner@example.com", "hash");
    const other = await repositories.users.create("other@example.com", "hash");
    const kit = await repositories.kits.create({
      ownerId: owner.id,
      status: "generating",
      version: 0,
      dedupeKey: "one",
      input: { jd: "Requirements\nTypeScript", companyUrl: "https://example.com", days: 5 },
      kit: null,
      counters: { requirement: 0, question: 0, flashcard: 0 },
      regenerating: [],
      deleted: false,
    });
    expect(kit.createdAt).toBeInstanceOf(Date);
    expect(await repositories.kits.findOwned(other.id, kit.id)).toBeNull();
    expect(await repositories.kits.findOwned(owner.id, kit.id)).not.toBeNull();
    const job = await repositories.jobs.create({
      ownerId: owner.id,
      kitId: kit.id,
      type: "create",
      status: "queued",
      steps: [],
      error: null,
    });
    expect(await repositories.jobs.findOwned(other.id, job.id)).toBeNull();
    expect(await repositories.jobs.findOwned(owner.id, job.id)).not.toBeNull();
    const event = {
      step: "validate",
      status: "running" as const,
      message: "Validating",
      at: new Date().toISOString(),
    };
    await Promise.all([
      repositories.jobs.addProgress(owner.id, job.id, event),
      repositories.jobs.addProgress(owner.id, job.id, { ...event, status: "done" }),
    ]);
    expect((await repositories.jobs.findOwned(owner.id, job.id))?.steps).toHaveLength(1);
    const review = await repositories.reviews.create({
      ownerId: owner.id,
      kitId: kit.id,
      cardId: "f1",
      confidence: 3,
      reviewedAt: new Date(),
    });
    expect(review.reviewedAt).toBeInstanceOf(Date);
    expect(await repositories.reviews.listOwned(other.id, kit.id)).toEqual([]);
    expect(await repositories.reviews.listOwned(owner.id, kit.id)).toHaveLength(1);
    expect(mongoose.connection.readyState).toBe(1);
  });

  it("enforces the unique dedupe index and compare-and-swap versioning", async () => {
    const owner = await repositories.users.findByEmail("owner@example.com");
    expect(owner).not.toBeNull();
    const first = await repositories.kits.findDuplicate(owner!.id, "one");
    expect(first).not.toBeNull();
    await expect(
      repositories.kits.create({
        ownerId: owner!.id,
        status: "generating",
        version: 0,
        dedupeKey: "one",
        input: first!.input,
        kit: null,
        counters: first!.counters,
        regenerating: [],
        deleted: false,
      }),
    ).rejects.toThrow();
    expect(await repositories.kits.setGenerationResult(owner!.id, first!.id, makeKit())).toBe(true);
    const ready = await repositories.kits.findOwned(owner!.id, first!.id);
    expect(ready?.status).toBe("ready");
    expect(
      await repositories.kits.compareAndSwap(owner!.id, first!.id, ready!.version, {
        ...ready!,
        counters: { requirement: 2, question: 2, flashcard: 2 },
      }),
    ).toBe(true);
    expect(
      await repositories.kits.compareAndSwap(owner!.id, first!.id, ready!.version, ready!),
    ).toBe(false);
    expect((await repositories.kits.findOwned(owner!.id, first!.id))?.version).toBe(
      ready!.version + 1,
    );
  });

  it("preserves section claims across kit edits and atomically resets retried jobs", async () => {
    const owner = await repositories.users.create("retry@example.com", "hash");
    const created = await repositories.kits.create({
      ownerId: owner.id,
      status: "ready",
      version: 0,
      dedupeKey: "retry",
      input: { jd: "Requirements", companyUrl: "https://example.com", days: 5 },
      kit: makeKit(),
      counters: { requirement: 2, question: 2, flashcard: 2 },
      regenerating: [],
      deleted: false,
    });
    const stale = (await repositories.kits.findOwned(owner.id, created.id))!;
    expect(await repositories.kits.claimSection(owner.id, created.id, "questions:technical")).toBe(
      true,
    );
    expect(await repositories.kits.compareAndSwap(owner.id, created.id, stale.version, stale)).toBe(
      true,
    );
    expect((await repositories.kits.findOwned(owner.id, created.id))?.regenerating).toEqual([
      "questions:technical",
    ]);
    expect(await repositories.kits.claimSection(owner.id, created.id, "questions:technical")).toBe(
      false,
    );
    const job = await repositories.jobs.create({
      ownerId: owner.id,
      kitId: created.id,
      type: "regenerate",
      section: "questions",
      category: "technical",
      status: "queued",
      steps: [],
      error: null,
    });
    expect(await repositories.jobs.transition(owner.id, job.id, ["queued"], "running")).toBe(true);
    await repositories.jobs.addProgress(owner.id, job.id, {
      step: "questions:technical",
      status: "failed",
      message: "Generation failed",
      at: new Date().toISOString(),
    });
    await repositories.jobs.finish(owner.id, job.id, "failed", {
      code: "GENERATION_FAILED",
      message: "Generation failed.",
    });
    expect((await repositories.jobs.findOwned(owner.id, job.id))?.finishedAt).toBeInstanceOf(Date);
    expect(await repositories.jobs.requeue(owner.id, job.id)).toBe(true);
    const retried = await repositories.jobs.findOwned(owner.id, job.id);
    expect(retried).toMatchObject({ status: "queued", error: null, steps: [] });
    expect(retried?.startedAt).toBeUndefined();
    expect(retried?.finishedAt).toBeUndefined();
    expect(await repositories.jobs.requeue(owner.id, job.id)).toBe(false);
    await repositories.kits.releaseSection(owner.id, created.id, "questions:technical");
  });

  it("reconciles persisted regeneration claims after restart", async () => {
    const owner = await repositories.users.create("recovery@example.com", "hash");
    const created = await repositories.kits.create({
      ownerId: owner.id,
      status: "ready",
      version: 0,
      dedupeKey: "recovery",
      input: { jd: "Requirements", companyUrl: "https://example.com", days: 5 },
      kit: makeKit(),
      counters: { requirement: 2, question: 2, flashcard: 2 },
      regenerating: [],
      deleted: false,
    });
    expect(await repositories.kits.claimSection(owner.id, created.id, "company_brief")).toBe(true);
    const job = await repositories.jobs.create({
      ownerId: owner.id,
      kitId: created.id,
      type: "regenerate",
      section: "company_brief",
      status: "queued",
      steps: [],
      error: null,
    });
    const runner = new JobRunner(repositories, new FixtureExecutor());
    expect(await runner.recover()).toBeGreaterThanOrEqual(1);
    expect((await repositories.jobs.findOwned(owner.id, job.id))?.status).toBe("interrupted");
    expect((await repositories.kits.findOwned(owner.id, created.id))?.regenerating).toEqual([]);
    expect(await repositories.kits.claimSection(owner.id, created.id, "company_brief")).toBe(true);
    await repositories.kits.releaseSection(owner.id, created.id, "company_brief");
  });

  it("persists the full authenticated HTTP workflow through MongoDB", async () => {
    const executor = new FixtureExecutor();
    const jobs = new JobRunner(repositories, executor);
    const environment = parseApiEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: server!.getUri(),
      SESSION_SECRET: "a-secure-test-session-secret-over-thirty-two-bytes",
      WEB_ORIGIN: "http://localhost:3000",
    });
    const app = createApp({
      repositories,
      jobs,
      environment,
      validateCompanyUrl: () => Promise.resolve(),
    });
    const owner = request.agent(app);
    const other = request.agent(app);
    expect(
      (
        await owner
          .post("/api/auth/register")
          .send({ email: "flow@example.com", password: "secure-password" })
      ).status,
    ).toBe(201);
    expect(
      (
        await other
          .post("/api/auth/register")
          .send({ email: "second@example.com", password: "secure-password" })
      ).status,
    ).toBe(201);
    const created = await owner.post("/api/kits").send({
      jd: "Requirements\n- Build TypeScript services",
      company_url: "https://example.com",
      days: 5,
    });
    expect(created.status).toBe(202);
    await jobs.drain();
    const kitId = created.body.kit_id as string;
    const jobId = created.body.job_id as string;
    expect((await owner.get(`/api/jobs/${jobId}`)).body.status).toBe("done");
    expect((await owner.get(`/api/kits/${kitId}`)).body.status).toBe("ready");
    expect((await other.get(`/api/kits/${kitId}`)).status).toBe(404);
    expect(
      (
        await owner
          .patch(`/api/kits/${kitId}/questions/q1`)
          .send({ prompt: "My TypeScript service design question" })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .post(`/api/kits/${kitId}/practice/reviews`)
          .send({ card_id: "f1", confidence: 3 })
      ).status,
    ).toBe(201);
    expect((await owner.get(`/api/kits/${kitId}/practice/progress`)).body.coveredCount).toBe(1);
    expect((await owner.post("/api/auth/logout")).status).toBe(204);
    expect((await owner.get(`/api/kits/${kitId}`)).status).toBe(401);
  });
});
