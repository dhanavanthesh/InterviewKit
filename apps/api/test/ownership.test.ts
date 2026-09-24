import { describe, expect, it } from "vitest";

import { createReadyKit, registerAgent, testContext } from "./support";

describe("owner isolation", () => {
  it("returns an empty list and identical 404 errors for every foreign resource group", async () => {
    const context = testContext();
    const owner = await registerAgent(context.app, "owner@example.com");
    const foreign = await registerAgent(context.app, "foreign@example.com");
    const { kitId, jobId } = await createReadyKit(context, owner);
    expect((await foreign.get("/api/kits")).body).toEqual([]);

    const cases: Array<[string, string, unknown?]> = [
      ["get", `/api/kits/${kitId}`],
      ["delete", `/api/kits/${kitId}`],
      ["get", `/api/jobs/${jobId}`],
      ["post", `/api/jobs/${jobId}/retry`],
      ["patch", `/api/kits/${kitId}/company-brief`, { summary: "foreign" }],
      ["patch", `/api/kits/${kitId}/role`, { title: "foreign" }],
      [
        "post",
        `/api/kits/${kitId}/requirements`,
        { text: "Foreign", kind: "technical", priority: "must" },
      ],
      ["patch", `/api/kits/${kitId}/requirements/r1`, { text: "Foreign" }],
      ["delete", `/api/kits/${kitId}/requirements/r1`],
      [
        "post",
        `/api/kits/${kitId}/questions`,
        {
          prompt: "Foreign?",
          answer_outline: "No",
          difficulty: 1,
          category: "technical",
          requirement_ids: ["r1"],
        },
      ],
      ["patch", `/api/kits/${kitId}/questions/q1`, { prompt: "Foreign" }],
      ["delete", `/api/kits/${kitId}/questions/q1`],
      ["put", `/api/kits/${kitId}/questions/order`, { category: "technical", ordered_ids: ["q1"] }],
      [
        "post",
        `/api/kits/${kitId}/flashcards`,
        { front: "Foreign", back: "No", requirement_ids: ["r1"] },
      ],
      ["patch", `/api/kits/${kitId}/flashcards/f1`, { front: "Foreign" }],
      ["delete", `/api/kits/${kitId}/flashcards/f1`],
      ["put", `/api/kits/${kitId}/flashcards/order`, { ordered_ids: ["f1", "f2"] }],
      ["patch", `/api/kits/${kitId}/schedule/days/1`, { focus: "Foreign" }],
      ["post", `/api/kits/${kitId}/regenerate`, { section: "schedule", confirm: true }],
      ["get", `/api/kits/${kitId}/coverage`],
      ["get", `/api/kits/${kitId}/practice/session`],
      ["post", `/api/kits/${kitId}/practice/reviews`, { card_id: "f1", confidence: 3 }],
      ["get", `/api/kits/${kitId}/practice/progress`],
    ];

    for (const [method, path, body] of cases) {
      const operation = foreign[method as "get"](path);
      const response =
        body === undefined || body === null ? await operation : await operation.send(body);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    }
  });

  it("deleting an owned kit removes its jobs and practice data", async () => {
    const context = testContext();
    const owner = await registerAgent(context.app);
    const { kitId, jobId } = await createReadyKit(context, owner);
    await owner.post(`/api/kits/${kitId}/practice/reviews`).send({ card_id: "f1", confidence: 3 });
    expect((await owner.delete(`/api/kits/${kitId}`)).status).toBe(204);
    expect((await owner.get(`/api/kits/${kitId}`)).status).toBe(404);
    expect((await owner.get(`/api/jobs/${jobId}`)).status).toBe(404);
    expect(
      await context.repositories.reviews.listOwned(
        (await context.repositories.users.findByEmail("user@example.com"))!.id,
        kitId,
      ),
    ).toEqual([]);
  });

  it("records tombstones only for deleted generated questions", async () => {
    const context = testContext();
    const owner = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, owner);
    await owner.delete(`/api/kits/${kitId}/questions/q1`);
    const generatedDeleted = await owner.get(`/api/kits/${kitId}`);
    expect(generatedDeleted.body.kit.tombstones.technical).toContain(
      "how would you build a typescript service",
    );
    const added = await owner.post(`/api/kits/${kitId}/questions`).send({
      prompt: "My own question",
      answer_outline: "My outline",
      difficulty: 1,
      category: "behavioural",
      requirement_ids: ["r2"],
    });
    await owner.delete(`/api/kits/${kitId}/questions/${added.body.question.id as string}`);
    const userDeleted = await owner.get(`/api/kits/${kitId}`);
    expect(userDeleted.body.kit.tombstones.behavioural ?? []).not.toContain("my own question");
  });

  it("rejects invalid writes without changing the kit version", async () => {
    const context = testContext();
    const owner = await registerAgent(context.app);
    const { kitId } = await createReadyKit(context, owner);
    const before = await owner.get(`/api/kits/${kitId}`);
    expect(
      (await owner.patch(`/api/kits/${kitId}/questions/q1`).send({ requirement_ids: ["missing"] }))
        .status,
    ).toBe(422);
    const after = await owner.get(`/api/kits/${kitId}`);
    expect(after.body.version).toBe(before.body.version);
    expect(after.body.kit.questions).toEqual(before.body.kit.questions);
  });
});
