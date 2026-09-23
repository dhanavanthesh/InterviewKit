import { describe, expect, it } from "vitest";

import { inferRequirementPriority } from "../src/index";

describe("priority cues", () => {
  it.each([
    ["TypeScript experience", "Requirements"],
    ["TypeScript is required", null],
    ["Must have TypeScript", null],
    ["Four years of Go", "Minimum Qualifications"],
    ["This skill is essential", null],
    ["You will need Python", null],
    ["Python experience", "Basic Qualifications"],
  ] as const)("classifies must cue: %s", (line, heading) => {
    expect(inferRequirementPriority(line, heading, "nice")).toBe("must");
  });

  it.each([
    ["GraphQL experience", "Preferred Qualifications"],
    ["Nice to have GraphQL", null],
    ["Bonus points for Rust", null],
    ["Rust is a plus", null],
    ["Ideally familiar with Kafka", null],
    ["Kafka is desirable", null],
    ["Good to have Redis", null],
    ["Redis knowledge is an advantage", null],
    ["Optional Kubernetes knowledge", null],
  ] as const)("classifies nice cue: %s", (line, heading) => {
    expect(inferRequirementPriority(line, heading, "must")).toBe("nice");
  });

  it("lets a nice cue win an apparent tie", () => {
    expect(inferRequirementPriority("Preferred but required by some teams", null, "must")).toBe(
      "nice",
    );
  });

  it("uses word boundaries", () => {
    expect(inferRequirementPriority("Experience with optionality types", null, "must")).toBe(
      "must",
    );
  });

  it("preserves supplied priority without explicit cues", () => {
    expect(inferRequirementPriority("Experience building APIs", "Responsibilities", "nice")).toBe(
      "nice",
    );
  });
});
