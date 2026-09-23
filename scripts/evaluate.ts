import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  InMemoryPipelineStore,
  LlmRateLimiter,
  PipelineError,
  createDiscussionSearcher,
  createGroqClient,
  createPageFetcher,
  loadConfig,
  runPipelineWithMetrics,
  systemClock,
  type PageFetcher,
} from "@interview-kit/core";
import {
  batchInputCaseSchema,
  batchOutputSchema,
  type BatchOutput,
  type StructuredError,
} from "@interview-kit/schema";

interface Arguments {
  input: string;
  output: string;
}

export function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith("--input=")) values.set("input", argument.slice(8));
    else if (argument.startsWith("--output=")) values.set("output", argument.slice(9));
    else if (argument === "--input" || argument === "--output") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new PipelineError("INVALID_ARGUMENTS", `${argument} requires a path.`);
      }
      values.set(argument.slice(2), value);
      index += 1;
    }
  }
  const input = values.get("input");
  const output = values.get("output");
  if (input === undefined || output === undefined || input.length === 0 || output.length === 0) {
    throw new PipelineError(
      "INVALID_ARGUMENTS",
      "Usage: npm run evaluate -- --input <cases.json> --output <kits.json>",
    );
  }
  return { input, output };
}

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function writeAtomic(destination: string, output: BatchOutput): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(
    temporary,
    `${JSON.stringify(batchOutputSchema.parse(output), null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, destination);
}

function structuredFailure(error: unknown): StructuredError {
  if (error instanceof PipelineError) return { code: error.code, message: error.message };
  return { code: "INTERNAL", message: "The case could not be completed." };
}

function cachingFetcher(fetcher: PageFetcher): PageFetcher {
  const cache = new Map<string, ReturnType<PageFetcher["fetch"]>>();
  return {
    fetch(url, options) {
      if (options?.skipRobots === true) return fetcher.fetch(url, options);
      const existing = cache.get(url);
      if (existing !== undefined) return existing;
      const operation = fetcher.fetch(url, options).catch((error: unknown) => {
        cache.delete(url);
        throw error;
      });
      cache.set(url, operation);
      return operation;
    },
  };
}

export async function main(): Promise<void> {
  let args: Arguments;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(structuredFailure(error).message);
    process.exitCode = 1;
    return;
  }
  const invocationRoot = process.env.INIT_CWD ?? process.cwd();
  const inputPath = path.resolve(invocationRoot, args.input);
  const outputPath = path.resolve(invocationRoot, args.output);
  const emptyOutput: BatchOutput = { version: "1.0", generated_at: timestamp(), kits: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  } catch {
    try {
      await writeAtomic(outputPath, emptyOutput);
    } catch {
      // The input error remains the primary run-level failure.
    }
    console.error("The input file could not be read as JSON.");
    process.exitCode = 1;
    return;
  }
  if (!isUnknownArray(raw)) {
    try {
      await writeAtomic(outputPath, emptyOutput);
    } catch {
      // The invalid outer document remains the primary run-level failure.
    }
    console.error("The input document must be an array of cases.");
    process.exitCode = 1;
    return;
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const loaded = loadConfig(repoRoot);
  const config = {
    ...loaded,
    allowPrivateHosts:
      process.env.ALLOW_PRIVATE_HOSTS === undefined ? true : loaded.allowPrivateHosts,
  };
  const deadlineAt = systemClock.now() + config.evalRunDeadlineMs;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), config.evalRunDeadlineMs);
  const limiter = new LlmRateLimiter({
    requestsPerMinute: config.llmRpm,
    tokensPerMinute: config.llmTpm,
    clock: systemClock,
  });
  const llm =
    config.groqApiKey === undefined
      ? undefined
      : createGroqClient({
          apiKey: config.groqApiKey,
          limiter,
          clock: systemClock,
          deadlineAt,
        });
  const fetcher = cachingFetcher(createPageFetcher({ config, clock: systemClock }));
  const discussion = createDiscussionSearcher({ clock: systemClock });
  type BatchResult = BatchOutput["kits"][number];
  const cases = raw;
  const results = new Array<BatchResult | undefined>(cases.length);
  let writeQueue = Promise.resolve();
  const persist = (): Promise<void> => {
    const snapshot: BatchOutput = {
      ...emptyOutput,
      kits: results.filter((result): result is BatchResult => result !== undefined),
    };
    writeQueue = writeQueue.then(() => writeAtomic(outputPath, snapshot));
    return writeQueue;
  };
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < cases.length) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= cases.length) return;
      const item = cases[index];
      const parsed = batchInputCaseSchema.safeParse(item);
      const fallbackId =
        typeof item === "object" && item !== null && "id" in item && typeof item.id === "string"
          ? item.id
          : `case-${index + 1}`;
      if (!parsed.success) {
        results[index] = {
          id: fallbackId.trim().length > 0 ? fallbackId : `case-${index + 1}`,
          status: "failed",
          kit: null,
          error: { code: "INVALID_INPUT", message: "The case input is invalid." },
        };
        await persist();
        continue;
      }
      const caseId = parsed.data.id;
      console.error(`[${caseId}] started`);
      try {
        if (systemClock.now() >= deadlineAt) {
          throw new PipelineError("DEADLINE_EXCEEDED", "The evaluator run deadline was reached.");
        }
        const result = await runPipelineWithMetrics(
          {
            jd: parsed.data.jd,
            companyUrl: parsed.data.company_url,
            days: parsed.data.days,
          },
          {
            ...(llm === undefined ? {} : { llm }),
            fetcher,
            store: new InMemoryPipelineStore(),
            discussion,
            clock: systemClock,
            config,
            signal: controller.signal,
            onProgress: (event) => console.error(`[${caseId}] ${event.step}: ${event.status}`),
          },
        );
        results[index] = { id: caseId, status: "ok", kit: result.kit, error: null };
        console.error(
          `[${caseId}] completed in ${result.durationMs}ms, tokens ${result.usage.totalTokens}`,
        );
      } catch (error) {
        const failure = structuredFailure(error);
        results[index] = { id: caseId, status: "failed", kit: null, error: failure };
        console.error(`[${caseId}] failed: ${failure.code} ${failure.message}`);
      }
      await persist();
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(config.evalConcurrency, Math.max(1, cases.length)) }, worker),
    );
    await persist();
  } catch {
    console.error("The output destination could not be written.");
    process.exitCode = 1;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.on("unhandledRejection", () => {
    console.error("An unexpected asynchronous error occurred.");
    process.exitCode = 1;
  });
  await main();
}
