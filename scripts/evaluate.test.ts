import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { batchOutputSchema, type BatchOutput } from "@interview-kit/schema";
import { describe, expect, it } from "vitest";

import { parseArguments, writeAtomic } from "./evaluate";

describe("evaluator CLI primitives", () => {
  it("accepts separated input and output arguments", () => {
    expect(parseArguments(["--input", "cases.json", "--output", "kits.json"])).toEqual({
      input: "cases.json",
      output: "kits.json",
    });
  });

  it("accepts equals argument forms", () => {
    expect(parseArguments(["--input=cases.json", "--output=kits.json"])).toEqual({
      input: "cases.json",
      output: "kits.json",
    });
  });

  it("rejects missing required paths", () => {
    expect(() => parseArguments(["--input", "cases.json"])).toThrow("Usage:");
  });

  it("creates output directories and writes Appendix B atomically", async () => {
    const destination = path.resolve("tmp", `cli-test-${process.pid}`, "nested", "kits.json");
    const output: BatchOutput = {
      version: "1.0",
      generated_at: "2026-09-23T12:00:00Z",
      kits: [],
    };
    await writeAtomic(destination, output);
    const parsed: unknown = JSON.parse(await readFile(destination, "utf8"));
    expect(batchOutputSchema.parse(parsed)).toEqual(output);
  });
});

describe("evaluator CLI end to end", () => {
  it("returns an ok JD-only kit for a malformed company URL", async () => {
    const directory = path.resolve("tmp", `cli-malformed-${process.pid}`);
    await mkdir(directory, { recursive: true });
    const input = path.join(directory, "cases.json");
    const output = path.join(directory, "kits.json");
    await writeFile(
      input,
      JSON.stringify([
        {
          id: "malformed-url",
          jd: "Backend Engineer\nRequirements\n- Must have production PostgreSQL experience.",
          company_url: "http://%",
          days: 2,
        },
      ]),
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/evaluate.ts", "--input", input, "--output", output],
      { env: { ...process.env, GROQ_API_KEY: "", INIT_CWD: process.cwd() }, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const parsed = batchOutputSchema.parse(JSON.parse(await readFile(output, "utf8")) as unknown);
    const entry = parsed.kits[0]!;
    expect(entry.status).toBe("ok");
    if (entry.status !== "ok") return;
    expect(entry.kit.warnings?.map(({ code }) => code)).toContain("COMPANY_UNREACHABLE");
    expect(entry.kit.schedule.days).toHaveLength(2);
  }, 30_000);
});
