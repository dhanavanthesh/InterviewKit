import type { Flashcard, Kit, Question, Requirement } from "@interview-kit/schema";

export const requirements: Requirement[] = [
  { id: "r1", text: "TypeScript", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Payments", kind: "domain", priority: "nice" },
];

export const questions: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Explain a TypeScript boundary.",
    answer_outline: "Validation and types",
    difficulty: 3,
  },
  {
    id: "q2",
    requirement_ids: ["r2"],
    category: "behavioural",
    prompt: "Describe a mentoring outcome.",
    answer_outline: "Use STAR",
    difficulty: 2,
  },
  {
    id: "q3",
    requirement_ids: ["r3"],
    category: "company-fit",
    prompt: "What makes payments reliable?",
    answer_outline: "Idempotency",
    difficulty: 1,
  },
];

export const flashcards: Flashcard[] = [
  { id: "f1", front: "Boundary", back: "Validate", requirement_ids: ["r1"] },
  { id: "f2", front: "Mentoring", back: "STAR", requirement_ids: ["r2"] },
  { id: "f3", front: "Payments", back: "Idempotency", requirement_ids: ["r3"] },
];

export function makeKit(): Kit {
  const kitRequirements = requirements.map((requirement) => ({ ...requirement }));
  const kitQuestions = questions.map((question) => ({
    ...question,
    requirement_ids: [...question.requirement_ids],
  }));
  const kitFlashcards = flashcards.map((card) => ({
    ...card,
    requirement_ids: [...card.requirement_ids],
  }));
  return {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Engineer",
      location: "Remote",
      jd_chars: 100,
      researched_at: "2026-09-23T10:00:00Z",
      pages_used: [],
    },
    company_brief: { summary: "", what_they_do: "", sources: [] },
    role: { title: "Engineer", seniority: "", responsibilities: [], requirements: kitRequirements },
    questions: kitQuestions,
    flashcards: kitFlashcards,
    schedule: {
      days_available: 3,
      days: kitQuestions.map((question, index) => ({
        day: index + 1,
        focus: question.prompt,
        question_ids: [question.id],
        minutes: 15,
      })),
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}
