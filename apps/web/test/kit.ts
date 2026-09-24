import { kitSchema, type Kit } from "@interview-kit/schema";

export function sampleKit(): Kit {
  return kitSchema.parse({
    source: {
      company: "Example",
      company_url: "https://example.com",
      role: "Engineer",
      location: "",
      jd_chars: 40,
      researched_at: "2026-09-24T00:00:00Z",
      pages_used: [],
    },
    company_brief: { summary: "Example builds tools.", what_they_do: "Tools", sources: [] },
    role: {
      title: "Engineer",
      seniority: "",
      responsibilities: [],
      requirements: [
        {
          id: "r1",
          text: "Build TypeScript services",
          kind: "technical",
          priority: "must",
          evidence: "Build TypeScript services",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "How do you build a TypeScript service?",
        answer_outline: "Discuss design and tests",
        difficulty: 2,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "Service design",
        back: "Design, tests, operation",
        requirement_ids: ["r1"],
        question_id: "q1",
      },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "TypeScript", question_ids: ["q1"], minutes: 15 }],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  });
}
