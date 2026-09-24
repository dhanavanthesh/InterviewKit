import { allocateSchedule, checkKitReferences, findGaps } from "@interview-kit/logic";
import { kitSchema, type Kit } from "@interview-kit/schema";

import { ApiError } from "../errors";

export function validateGeneratedKit(value: unknown, requestedDays: number): Kit {
  const parsed = kitSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("KIT_INVALID", "The generated kit does not match the required structure.");
  }
  const kit = parsed.data;
  const issues = checkKitReferences(kit);
  if (issues.length > 0) throw new ApiError("KIT_INVALID", issues[0]!.message);
  if (kit.schedule.days_available !== requestedDays || kit.schedule.days.length !== requestedDays) {
    throw new ApiError("KIT_INVALID", "The generated schedule has the wrong number of days.");
  }
  if (findGaps(kit.role.requirements, kit.questions).must.length > 0) {
    throw new ApiError("KIT_INVALID", "The generated kit has an uncovered must-have requirement.");
  }
  return kit;
}

function preserveEditedSchedule(kit: Kit): Kit["schedule"] {
  const validQuestionIds = new Set(kit.questions.map(({ id }) => id));
  const days = Array.from({ length: kit.schedule.days_available }, (_, index) => {
    const existing = kit.schedule.days[index];
    return existing === undefined
      ? {
          day: index + 1,
          focus: "Review the company brief and job description",
          question_ids: [],
          minutes: 30,
        }
      : {
          ...existing,
          day: index + 1,
          question_ids: [...new Set(existing.question_ids)].filter((id) =>
            validQuestionIds.has(id),
          ),
        };
  });
  const placed = new Set(days.flatMap(({ question_ids }) => question_ids));
  for (const question of kit.questions) {
    if (placed.has(question.id)) continue;
    const target = days.reduce((lightest, day) =>
      day.question_ids.length < lightest.question_ids.length ? day : lightest,
    );
    target.question_ids.push(question.id);
  }
  return { days_available: kit.schedule.days_available, days, edited: true };
}

export function normalizeEditableKit(value: Kit): Kit {
  const gaps = findGaps(value.role.requirements, value.questions);
  const schedule =
    value.schedule.edited === true
      ? preserveEditedSchedule(value)
      : allocateSchedule({
          requirements: value.role.requirements,
          questions: value.questions,
          flashcards: value.flashcards,
          daysAvailable: value.schedule.days_available,
        });
  return {
    ...value,
    schedule,
    coverage: { ...value.coverage, uncovered_requirement_ids: gaps.all },
  };
}

export function validateEditableKit(value: unknown): Kit {
  const parsed = kitSchema.safeParse(value);
  if (!parsed.success)
    throw new ApiError("KIT_INVALID", "The kit does not match the required structure.");
  const normalized = normalizeEditableKit(parsed.data);
  const reparsed = kitSchema.safeParse(normalized);
  if (!reparsed.success) throw new ApiError("KIT_INVALID", "The edited kit is invalid.");
  const issues = checkKitReferences(reparsed.data);
  if (issues.length > 0) throw new ApiError("KIT_INVALID", issues[0]!.message);
  return reparsed.data;
}
