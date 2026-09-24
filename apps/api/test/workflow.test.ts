import { describe, expect, it, vi } from "vitest";

import { createReadyKit, FixtureExecutor, registerAgent, testContext } from "./support";

describe("kit creation and jobs", () => {
  it("returns 202 immediately, persists progress and produces a reopenable valid kit", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const created = await agent.post("/api/kits").send({
      jd: "Requirements\n- Build TypeScript services",
      company_url: "https://example.com",
      days: 60,
    });
    expect(created.status).toBe(202);
    expect(created.body).toMatchObject({ status: "generating", existing: false });
    await context.jobs.drain();
    const job = await agent.get(`/api/jobs/${created.body.job_id as string}`);
    expect(job.body.status).toBe("done");
    expect(job.body.steps.map((step: { step: string }) => step.step)).toEqual([
      "validate",
      "save/write",
    ]);
    const detail = await agent.get(`/api/kits/${created.body.kit_id as string}`);
    expect(detail.body.status).toBe("ready");
    expect(detail.body.kit.schedule.days).toHaveLength(60);
    expect(context.executor.createCalls[0]?.input.days).toBe(60);
  });

  it("deduplicates ready kits, supports force and converges concurrent requests", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const body = {
      jd: "Requirements\n- Build TypeScript services",
      company_url: "https://example.com",
      days: 5,
    };
    const [first, concurrent] = await Promise.all([
      agent.post("/api/kits").send(body),
      agent.post("/api/kits").send(body),
    ]);
    expect(first.body.kit_id).toBe(concurrent.body.kit_id);
    await context.jobs.drain();
    const readyDuplicate = await agent.post("/api/kits").send(body);
    expect(readyDuplicate.status).toBe(200);
    expect(readyDuplicate.body.kit_id).toBe(first.body.kit_id);
    const forced = await agent.post("/api/kits").send({ ...body, force: true });
    expect(forced.status).toBe(202);
    expect(forced.body.kit_id).not.toBe(first.body.kit_id);
  });

  it("validates URL safety, JD length and day boundaries before creating a job", async () => {
    const context = testContext({ validateUrl: () => Promise.reject(new Error("blocked")) });
    const agent = await registerAgent(context.app);
    expect(
      (
        await agent
          .post("/api/kits")
          .send({ jd: "valid", company_url: "http://127.0.0.1", days: 5 })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post("/api/kits")
          .send({ jd: "x".repeat(30_001), company_url: "https://example.com", days: 5 })
      ).status,
    ).toBe(400);
    const allowed = testContext();
    const allowedAgent = await registerAgent(allowed.app, "days@example.com");
    expect(
      (
        await allowedAgent
          .post("/api/kits")
          .send({ jd: "valid", company_url: "https://example.com", days: 1 })
      ).status,
    ).toBe(202);
    expect(
      (
        await allowedAgent
          .post("/api/kits")
          .send({ jd: "another", company_url: "https://example.com", days: 60 })
      ).status,
    ).toBe(202);
  });

  it("stores safe generation failures and retries only failed jobs", async () => {
    const executor = new FixtureExecutor();
    executor.failCreate = true;
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const created = await agent.post("/api/kits").send({
      jd: "Requirements\n- Build TypeScript services",
      company_url: "https://example.com",
      days: 5,
    });
    await context.jobs.drain();
    const failed = await agent.get(`/api/jobs/${created.body.job_id as string}`);
    expect(failed.body.status).toBe("failed");
    expect(JSON.stringify(failed.body)).not.toContain("hidden details");
    executor.failCreate = false;
    expect((await agent.post(`/api/jobs/${created.body.job_id as string}/retry`)).status).toBe(202);
    await context.jobs.drain();
    expect((await agent.get(`/api/jobs/${created.body.job_id as string}`)).body.status).toBe(
      "done",
    );
    expect((await agent.post(`/api/jobs/${created.body.job_id as string}/retry`)).status).toBe(409);
  });

  it("marks stale jobs interrupted on recovery", async () => {
    const context = testContext();
    const user = await context.repositories.users.create("user@example.com", "hash");
    const kit = await context.repositories.kits.create({
      ownerId: user.id,
      status: "generating",
      version: 0,
      dedupeKey: "stale",
      input: { jd: "jd", companyUrl: "https://example.com", days: 5 },
      kit: null,
      counters: { requirement: 0, question: 0, flashcard: 0 },
      regenerating: [],
      deleted: false,
    });
    const job = await context.repositories.jobs.create({
      ownerId: user.id,
      kitId: kit.id,
      type: "create",
      status: "running",
      steps: [],
      error: null,
    });
    expect(await context.jobs.recover()).toBe(1);
    expect((await context.repositories.jobs.findOwned(user.id, job.id))?.status).toBe(
      "interrupted",
    );
  });

  it("enforces the generation rate limit with the standard error shape", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    let last;
    for (let index = 0; index < 11; index += 1) {
      last = await agent.post("/api/kits").send({
        jd: `Requirements\n- Skill ${index}`,
        company_url: "https://example.com",
        days: 5,
        force: true,
      });
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe("RATE_LIMITED");
    await context.jobs.drain();
  });

  it("does not let a deleted kit reappear after an active job finishes", async () => {
    let release = (): void => undefined;
    const executor = new FixtureExecutor();
    executor.createGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const created = await agent
      .post("/api/kits")
      .send({ jd: "Requirements\n- TypeScript", company_url: "https://example.com", days: 5 });
    expect((await agent.delete(`/api/kits/${created.body.kit_id as string}`)).status).toBe(204);
    release();
    await context.jobs.drain();
    expect((await agent.get(`/api/kits/${created.body.kit_id as string}`)).status).toBe(404);
  });
});

describe("batch upload", () => {
  it("starts valid rows, reports invalid rows and applies default days", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const rows = [
      { jd: "Requirements\n- TypeScript", company_url: "https://example.com" },
      { jd: "", company_url: "not-url", days: 4 },
      { jd: "Requirements\n- APIs", company_url: "https://example.org", days: 1 },
    ];
    const response = await agent
      .post("/api/kits/batch")
      .field("default_days", "7")
      .attach("file", Buffer.from(JSON.stringify(rows)), {
        filename: "roles.json",
        contentType: "application/json",
      });
    expect(response.status).toBe(202);
    expect(response.body[0]).toMatchObject({ row: 0, error: null });
    expect(response.body[1].error.code).toBe("VALIDATION_FAILED");
    expect(response.body[2]).toMatchObject({ row: 2, error: null });
    await context.jobs.drain();
    expect(context.executor.createCalls.map(({ input }) => input.days)).toEqual([7, 1]);
  });

  it("rejects invalid JSON, non-JSON uploads, excessive rows and oversized files", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    expect(
      (
        await agent.post("/api/kits/batch").attach("file", Buffer.from("{"), {
          filename: "bad.json",
          contentType: "application/json",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent.post("/api/kits/batch").attach("file", Buffer.from([0, 1, 2]), {
          filename: "bad.bin",
          contentType: "application/octet-stream",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post("/api/kits/batch")
          .attach("file", Buffer.from(JSON.stringify(Array.from({ length: 51 }, () => ({})))), {
            filename: "many.json",
            contentType: "application/json",
          })
      ).status,
    ).toBe(400);
    const tooLarge = await agent
      .post("/api/kits/batch")
      .attach("file", Buffer.alloc(1_048_577, 32), {
        filename: "large.json",
        contentType: "application/json",
      });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("builder, regeneration and practice", () => {
  it("supports the complete editing and practice workflow with truthful gaps", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const { kitId, detail } = await createReadyKit(context, agent);
    const version = detail.body.version as number;
    const brief = await agent
      .patch(`/api/kits/${kitId}/company-brief`)
      .send({ summary: "My edited summary" });
    expect(brief.body.version).toBe(version + 1);
    expect(brief.body.company_brief.summary_edited).toBe(true);
    expect(
      (await agent.patch(`/api/kits/${kitId}/role`).send({ title: "Platform Engineer" })).body.role
        .title,
    ).toBe("Platform Engineer");

    const requirement = await agent
      .post(`/api/kits/${kitId}/requirements`)
      .send({ text: "Operate Kubernetes", kind: "technical", priority: "must" });
    const requirementId = requirement.body.requirement.id as string;
    expect(requirementId).toBe("r3");
    expect(
      (
        await agent
          .patch(`/api/kits/${kitId}/requirements/${requirementId}`)
          .send({ priority: "nice" })
      ).body.requirement.priority,
    ).toBe("nice");
    await agent
      .patch(`/api/kits/${kitId}/requirements/${requirementId}`)
      .send({ priority: "must" });
    let coverage = await agent.get(`/api/kits/${kitId}/coverage`);
    expect(coverage.body.must_uncovered_requirement_ids).toContain(requirementId);

    const question = await agent.post(`/api/kits/${kitId}/questions`).send({
      prompt: "How would you operate Kubernetes?",
      answer_outline: "Discuss reliability.",
      difficulty: 3,
      category: "technical",
      requirement_ids: [requirementId],
    });
    const questionId = question.body.question.id as string;
    expect(questionId).toBe("q3");
    coverage = await agent.get(`/api/kits/${kitId}/coverage`);
    expect(coverage.body.must_uncovered_requirement_ids).not.toContain(requirementId);
    const moved = await agent
      .patch(`/api/kits/${kitId}/questions/${questionId}`)
      .send({ category: "system-design", pinned: true });
    expect(moved.body.question).toMatchObject({
      id: questionId,
      category: "system-design",
      edited: true,
      pinned: true,
    });

    const card = await agent.post(`/api/kits/${kitId}/flashcards`).send({
      front: "Kubernetes reliability",
      back: "Health checks and rollouts",
      requirement_ids: [requirementId],
      question_id: questionId,
    });
    const cardId = card.body.flashcard.id as string;
    expect(cardId).toBe("f3");
    const unlinked = await agent
      .patch(`/api/kits/${kitId}/flashcards/${cardId}`)
      .send({ question_id: null });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.flashcard).not.toHaveProperty("question_id");
    expect(
      (
        await agent
          .patch(`/api/kits/${kitId}/flashcards/${cardId}`)
          .send({ back: "Updated answer", pinned: true })
      ).body.flashcard,
    ).toMatchObject({ back: "Updated answer", pinned: true, edited: true });
    expect(
      (
        await agent
          .patch(`/api/kits/${kitId}/schedule/days/1`)
          .send({ focus: "My focus", minutes: 45 })
      ).body.schedule.edited,
    ).toBe(true);
    expect(
      (await agent.post(`/api/kits/${kitId}/regenerate`).send({ section: "schedule" })).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post(`/api/kits/${kitId}/regenerate`)
          .send({ section: "schedule", confirm: true })
      ).status,
    ).toBe(200);

    const session = await agent.get(`/api/kits/${kitId}/practice/session`);
    expect(session.body.card_ids).toContain(cardId);
    expect(
      (
        await agent
          .post(`/api/kits/${kitId}/practice/reviews`)
          .send({ card_id: cardId, confidence: 3 })
      ).status,
    ).toBe(201);
    const progress = await agent.get(`/api/kits/${kitId}/practice/progress`);
    expect(progress.body.coveredCardIds).toContain(cardId);
    expect(progress.body.requirement_readiness[requirementId]).toBe(true);
    expect(
      (
        await agent
          .post(`/api/kits/${kitId}/practice/reviews`)
          .send({ card_id: cardId, confidence: 5 })
      ).status,
    ).toBe(400);

    expect((await agent.delete(`/api/kits/${kitId}/questions/${questionId}`)).status).toBe(204);
    coverage = await agent.get(`/api/kits/${kitId}/coverage`);
    expect(coverage.body.must_uncovered_requirement_ids).toContain(requirementId);
    const final = await agent.get(`/api/kits/${kitId}`);
    const allQuestionIds = new Set(final.body.kit.questions.map((item: { id: string }) => item.id));
    expect(
      final.body.kit.schedule.days
        .flatMap((day: { question_ids: string[] }) => day.question_ids)
        .every((id: string) => allQuestionIds.has(id)),
    ).toBe(true);
  });

  it("clears the busy flag when regeneration fails", async () => {
    const executor = new FixtureExecutor();
    executor.failRegenerate = true;
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const started = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "company_brief" });
    await context.jobs.drain();
    expect((await agent.get(`/api/jobs/${started.body.job_id as string}`)).body.status).toBe(
      "failed",
    );
    executor.failRegenerate = false;
    expect(
      (await agent.post(`/api/kits/${kitId}/regenerate`).send({ section: "company_brief" })).status,
    ).toBe(202);
    await context.jobs.drain();
  });

  it("reclaims the section on failed regeneration retry and releases it on completion", async () => {
    let release = (): void => undefined;
    const executor = new FixtureExecutor();
    executor.failRegenerate = true;
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const owner = (await context.repositories.users.findByEmail("user@example.com"))!;
    const started = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "questions", category: "technical" });
    const jobId = started.body.job_id as string;
    await context.jobs.drain();
    expect((await agent.get(`/api/jobs/${jobId}`)).body.status).toBe("failed");
    executor.failRegenerate = false;
    executor.regenerateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const retried = await agent.post(`/api/jobs/${jobId}/retry`);
    expect(retried.status).toBe(202);
    const retryJob = await agent.get(`/api/jobs/${jobId}`);
    expect(retryJob.body.error).toBeNull();
    expect(retryJob.body.steps).toEqual([]);
    expect(
      (await context.repositories.jobs.findOwned(owner.id, jobId))?.finishedAt,
    ).toBeUndefined();
    expect((await context.repositories.kits.findOwned(owner.id, kitId))?.regenerating).toContain(
      "questions:technical",
    );
    const competing = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "questions", category: "technical" });
    expect(competing.status).toBe(409);
    expect(competing.body.error.code).toBe("SECTION_BUSY");
    release();
    await context.jobs.drain();
    expect((await agent.get(`/api/jobs/${jobId}`)).body.status).toBe("done");
    const next = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "questions", category: "technical" });
    expect(next.status).toBe(202);
    await context.jobs.drain();
  });

  it("releases the section when a retry cannot be requeued", async () => {
    const executor = new FixtureExecutor();
    executor.failRegenerate = true;
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const started = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "company_brief" });
    await context.jobs.drain();
    const requeue = vi.spyOn(context.repositories.jobs, "requeue").mockResolvedValue(false);
    const failedRetry = await agent.post(`/api/jobs/${started.body.job_id as string}/retry`);
    expect(failedRetry.status).toBe(409);
    expect(failedRetry.body.error.code).toBe("SECTION_BUSY");
    requeue.mockRestore();
    const competing = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "company_brief" });
    expect(competing.status).toBe(202);
    await context.jobs.drain();
  });

  it("does not retry a failed regeneration while another job owns its section", async () => {
    let release = (): void => undefined;
    const executor = new FixtureExecutor();
    executor.failRegenerate = true;
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const failed = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "company_brief" });
    await context.jobs.drain();
    executor.failRegenerate = false;
    executor.regenerateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "company_brief" });
    expect(active.status).toBe(202);
    const retry = await agent.post(`/api/jobs/${failed.body.job_id as string}/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("SECTION_BUSY");
    expect((await agent.get(`/api/jobs/${failed.body.job_id as string}`)).body.status).toBe(
      "failed",
    );
    release();
    await context.jobs.drain();
  });

  it("clears interrupted regeneration claims on restart and lets retry reclaim them", async () => {
    let release = (): void => undefined;
    const executor = new FixtureExecutor();
    executor.regenerateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const owner = (await context.repositories.users.findByEmail("user@example.com"))!;
    expect(await context.repositories.kits.claimSection(owner.id, kitId, "company_brief")).toBe(
      true,
    );
    const interrupted = await context.repositories.jobs.create({
      ownerId: owner.id,
      kitId,
      type: "regenerate",
      section: "company_brief",
      status: "running",
      steps: [],
      error: null,
    });
    expect(await context.jobs.recover()).toBe(1);
    expect((await context.repositories.jobs.findOwned(owner.id, interrupted.id))?.status).toBe(
      "interrupted",
    );
    expect((await context.repositories.kits.findOwned(owner.id, kitId))?.regenerating).toEqual([]);
    expect(await context.jobs.recover()).toBe(0);
    expect((await agent.post(`/api/jobs/${interrupted.id}/retry`)).status).toBe(202);
    expect((await context.repositories.kits.findOwned(owner.id, kitId))?.regenerating).toContain(
      "company_brief",
    );
    expect(
      (await agent.post(`/api/kits/${kitId}/regenerate`).send({ section: "company_brief" })).body
        .error.code,
    ).toBe("SECTION_BUSY");
    release();
    await context.jobs.drain();
    expect((await context.repositories.kits.findOwned(owner.id, kitId))?.regenerating).toEqual([]);
  });

  it("requires exact reorder sets and keeps pin-only edits from changing edited state", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const pin = await agent.patch(`/api/kits/${kitId}/questions/q1`).send({ pinned: true });
    expect(pin.body.question.edited).toBe(false);
    expect(
      (
        await agent
          .put(`/api/kits/${kitId}/questions/order`)
          .send({ category: "technical", ordered_ids: [] })
      ).status,
    ).toBe(422);
    expect(
      (
        await agent
          .put(`/api/kits/${kitId}/questions/order`)
          .send({ category: "technical", ordered_ids: ["q1"] })
      ).status,
    ).toBe(200);
    expect(
      (await agent.put(`/api/kits/${kitId}/flashcards/order`).send({ ordered_ids: ["f1"] })).status,
    ).toBe(422);
  });

  it("preserves a concurrent user edit and clears same-section busy state", async () => {
    let release = (): void => undefined;
    const executor = new FixtureExecutor();
    executor.regenerateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = testContext({ executor });
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    const regeneration = await agent
      .post(`/api/kits/${kitId}/regenerate`)
      .send({ section: "questions", category: "technical" });
    expect(regeneration.status).toBe(202);
    expect(
      (
        await agent
          .post(`/api/kits/${kitId}/regenerate`)
          .send({ section: "questions", category: "technical" })
      ).body.error.code,
    ).toBe("SECTION_BUSY");
    await agent.patch(`/api/kits/${kitId}/questions/q1`).send({ prompt: "My concurrent edit" });
    release();
    await context.jobs.drain();
    const detail = await agent.get(`/api/kits/${kitId}`);
    expect(detail.body.kit.questions.find((item: { id: string }) => item.id === "q1").prompt).toBe(
      "My concurrent edit",
    );
    expect(
      (
        await agent
          .post(`/api/kits/${kitId}/regenerate`)
          .send({ section: "questions", category: "technical" })
      ).status,
    ).toBe(202);
    release();
  });

  it("cleans references when deleting requirements and reviews when deleting cards", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    await agent.post(`/api/kits/${kitId}/practice/reviews`).send({ card_id: "f1", confidence: 2 });
    expect((await agent.delete(`/api/kits/${kitId}/requirements/r1`)).status).toBe(204);
    const detail = await agent.get(`/api/kits/${kitId}`);
    expect(
      detail.body.kit.questions.some((question: { requirement_ids: string[] }) =>
        question.requirement_ids.includes("r1"),
      ),
    ).toBe(false);
    expect(
      detail.body.kit.flashcards.some((card: { requirement_ids: string[] }) =>
        card.requirement_ids.includes("r1"),
      ),
    ).toBe(false);
  });

  it("keeps an edited flashcard when its source question is deleted without a dangling link", async () => {
    const context = testContext();
    const agent = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, agent);
    await agent.patch(`/api/kits/${kitId}/flashcards/f1`).send({ back: "My answer" });
    expect((await agent.delete(`/api/kits/${kitId}/questions/q1`)).status).toBe(204);
    const detail = await agent.get(`/api/kits/${kitId}`);
    expect(
      detail.body.kit.flashcards.find((card: { id: string }) => card.id === "f1"),
    ).toMatchObject({
      id: "f1",
      back: "My answer",
    });
    expect(
      detail.body.kit.flashcards.find((card: { id: string }) => card.id === "f1"),
    ).not.toHaveProperty("question_id");
  });
});
