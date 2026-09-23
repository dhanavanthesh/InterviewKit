import { describe, expect, it } from "vitest";

import { batchInputSchema, batchOutputSchema, kitSchema, type Kit } from "../src/index";

function validKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Engineer",
      location: "Remote",
      jd_chars: 120,
      researched_at: "2026-09-23T10:00:00Z",
      pages_used: ["http://localhost:8099/acme/"],
    },
    company_brief: {
      summary: "Acme builds tools.",
      what_they_do: "Developer tooling",
      sources: ["http://localhost:8099/acme/"],
    },
    role: {
      title: "Engineer",
      seniority: "Senior",
      responsibilities: ["Build reliable services"],
      requirements: [{ id: "r1", text: "TypeScript", kind: "technical", priority: "must" }],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "How do you design a TypeScript service?",
        answer_outline: "Discuss boundaries and validation.",
        difficulty: 2,
      },
    ],
    flashcards: [
      { id: "f1", front: "TypeScript boundary", back: "Validate inputs", requirement_ids: ["r1"] },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "TypeScript", question_ids: ["q1"], minutes: 15 }],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("Appendix A kit schema", () => {
  it("accepts a complete kit", () => {
    expect(kitSchema.safeParse(validKit()).success).toBe(true);
  });

  it.each([
    "source",
    "company_brief",
    "role",
    "questions",
    "flashcards",
    "schedule",
    "coverage",
  ] as const)("rejects a missing %s field", (field) => {
    const kit = validKit();
    const incomplete = { ...kit } as Record<string, unknown>;
    delete incomplete[field];
    expect(kitSchema.safeParse(incomplete).success).toBe(false);
  });

  it("rejects missing nested fields", () => {
    const kit = validKit();
    const source = { ...kit.source } as Record<string, unknown>;
    delete source.jd_chars;
    expect(kitSchema.safeParse({ ...kit, source }).success).toBe(false);
  });

  it.each(["technical", "behavioural", "domain"])("accepts requirement kind %s", (kind) => {
    const kit = validKit();
    kit.role.requirements[0] = { ...kit.role.requirements[0]!, kind } as never;
    expect(kitSchema.safeParse(kit).success).toBe(true);
  });

  it.each(["behavioral", "unknown"])("rejects requirement kind %s", (kind) => {
    const kit = validKit();
    kit.role.requirements[0] = { ...kit.role.requirements[0]!, kind } as never;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it.each(["technical", "behavioural", "system-design", "company-fit"])(
    "accepts question category %s",
    (category) => {
      const kit = validKit();
      kit.questions[0] = { ...kit.questions[0]!, category } as never;
      expect(kitSchema.safeParse(kit).success).toBe(true);
    },
  );

  it("rejects an unknown question category", () => {
    const kit = validKit();
    kit.questions[0] = { ...kit.questions[0]!, category: "culture" } as never;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it.each(["must", "nice"])("accepts priority %s", (priority) => {
    const kit = validKit();
    kit.role.requirements[0] = { ...kit.role.requirements[0]!, priority } as never;
    expect(kitSchema.safeParse(kit).success).toBe(true);
  });

  it("rejects an unknown priority", () => {
    const kit = validKit();
    kit.role.requirements[0] = { ...kit.role.requirements[0]!, priority: "optional" } as never;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it.each([1, 2, 3])("accepts difficulty %s", (difficulty) => {
    const kit = validKit();
    kit.questions[0] = { ...kit.questions[0]!, difficulty };
    expect(kitSchema.safeParse(kit).success).toBe(true);
  });

  it.each([0, 1.5, 4])("rejects difficulty %s", (difficulty) => {
    const kit = validKit();
    kit.questions[0] = { ...kit.questions[0]!, difficulty };
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it("accepts integer minutes and rejects floats", () => {
    const kit = validKit();
    expect(kitSchema.safeParse(kit).success).toBe(true);
    kit.schedule.days[0]!.minutes = 15.5;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it("rejects non-integer days", () => {
    const kit = validKit();
    kit.schedule.days_available = 1.5;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });
});

describe("Appendix B schemas", () => {
  it("accepts localhost, 1-day, and 60-day inputs", () => {
    const input = [
      { id: "one", jd: "Requires TypeScript", company_url: "http://localhost:8099/a/", days: 1 },
      { id: "sixty", jd: "Requires React", company_url: "https://example.com", days: 60 },
    ];
    expect(batchInputSchema.safeParse(input).success).toBe(true);
  });

  it("accepts valid ok and failed results", () => {
    const output = {
      version: "1.0",
      generated_at: "2026-09-23T10:00:00Z",
      kits: [
        { id: "ok", status: "ok", kit: validKit(), error: null },
        {
          id: "failed",
          status: "failed",
          kit: null,
          error: { code: "KIT_INVALID", message: "Could not produce a valid kit." },
        },
      ],
    };
    expect(batchOutputSchema.safeParse(output).success).toBe(true);
  });

  it("rejects invalid ok and failed combinations", () => {
    const output = {
      version: "1.0",
      generated_at: "2026-09-23T10:00:00Z",
      kits: [{ id: "bad", status: "ok", kit: null, error: null }],
    };
    expect(batchOutputSchema.safeParse(output).success).toBe(false);
  });

  it("rejects an invalid generated timestamp", () => {
    expect(
      batchOutputSchema.safeParse({ version: "1.0", generated_at: "today", kits: [] }).success,
    ).toBe(false);
  });
});
