# InterviewKit

InterviewKit turns a job description, company website, and available study time into an evidence-grounded interview preparation kit. It researches public company material, extracts only requirements supported by the job description, generates categorized questions, closes coverage gaps, creates flashcards, and allocates an exact-day schedule.

## Requirements

- Node.js 20
- npm 10 or later
- A Groq API key for model-assisted generation

The evaluator remains functional without a Groq key. In that mode it uses conservative code extraction, grounded fallback questions, deterministic flashcards, and the same final validation path.

## Installation

```sh
npm ci
copy .env.example .env
```

Set `GROQ_API_KEY` in `.env`. The evaluator does not require MongoDB, a web server, or application credentials.

## Batch evaluator

```sh
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Paths are resolved from `INIT_CWD` when npm provides it, otherwise from the current directory. Both `--input path` and `--input=path` forms are supported.

Input example:

```json
[
  {
    "id": "case-01",
    "jd": "Senior Backend Engineer\nRequirements\n- TypeScript service experience is required.",
    "company_url": "http://localhost:8099/normal/",
    "days": 5
  }
]
```

Output uses Appendix B exactly, writes atomically after each completed case, and continues when an individual case fails. A partial-research kit remains `ok`; `failed` is reserved for a case that cannot produce a valid kit.

## Architecture

The npm workspace separates contracts, deterministic logic, and retrieval or generation concerns:

- `packages/schema` owns Appendix A and B Zod contracts.
- `packages/logic` owns references, coverage, scheduling, item state, regeneration merge, and practice ordering.
- `packages/core` owns retrieval, model integration, grounded generation, assembly, repair, and the shared `runPipeline` function.
- `scripts/evaluate.ts` owns arguments, bounded batch concurrency, progress reporting, and atomic output only.

The CLI and future backend use the same pipeline with injected fetching, model, storage, clock, progress, and cancellation dependencies.

## Pipeline sequence

1. Validate input and preserve raw job-description length.
2. Extract role fields and candidate requirements while company research begins independently.
3. Ground every requirement and role field against job-description evidence.
4. Validate the URL, retrieve robots policy, fetch the homepage, and crawl ranked links.
5. Classify pages and extract supported hiring stages.
6. Search Hacker News through its Algolia API for relevant public interview discussion.
7. Build a company brief whose sources are restricted to fetched pages.
8. Plan technical, behavioural, system-design, and company-fit groups in code.
9. Generate each category independently and validate all requirement links.
10. Calculate gaps in code, request gap-only questions, and recheck coverage.
11. Close remaining gaps with deterministic grounded questions.
12. Create flashcards, allocate exact study days, safely repair, and validate the final kit.

Progress events identify every stage, including coverage passes and skipped research.

## Retrieval and safety

The crawler discovers links from the full DOM before navigation elements are removed. It scores anchor text and paths for hiring, about, and engineering signals instead of guessing fixed paths. Relative links and redirects resolve against the final response URL, and local path prefixes are preserved.

Production URL validation accepts only HTTP and HTTPS, rejects credentials, resolves DNS, validates every returned address, and uses an Undici dispatcher pinned to validated addresses. Loopback, private, link-local, metadata, CGNAT, multicast, reserved, IPv6 local, and IPv4-mapped private destinations are blocked by default. `ALLOW_PRIVATE_HOSTS=true` explicitly permits local evaluator sites while retaining scheme and credential checks.

Requests have bounded redirects, attempts, timeouts, body bytes, page counts, depth, and research duration. Only HTML, XHTML, and plain text are accepted. Responses to 429 and transient server failures use bounded backoff and `Retry-After`.

Robots policy is cached per host and checked before retrieval. Disallowed pages are recorded and never fetched. Sitemap declarations are discovery hints. Robots 4xx means no policy; robots 5xx blocks that host for the current run. Supported page and header robot directives are respected.

## Public discussion

Public interview discussion comes from the Hacker News Algolia Search API. Results must contain the exact company name or domain and an interview term. Generic-name noise and foreign sources are removed in code. Sparse or unavailable results produce `discussion: null` and `NO_PUBLIC_DISCUSSION`.

## Model and code responsibilities

Groq provides model-assisted text generation:

- `openai/gpt-oss-120b` handles job extraction and category questions.
- `openai/gpt-oss-20b` handles lighter company, hiring, discussion, and flashcard work.

Requests use strict JSON-schema structured output, low reasoning effort, bounded completion sizes, no model tools, Zod validation, and one repair attempt. Job descriptions, pages, and discussion results are marked as untrusted data. Embedded instructions are ignored.

Code decides evidence validity, priority corrections, stable IDs, allowed sources and requirement links, category planning, coverage, fallbacks, scheduling, final validity, and batch status. Model output cannot create a requirement absent from the job description or claim coverage with foreign IDs.

## Grounding and no-invention policy

Evidence must occur inside a job-description line. Exact normalized evidence is preferred; a high token-overlap line match may recover formatting variations and replaces evidence with the actual line. A longer invented claim cannot match a shorter posting line. Unsupported requirements and role fields are removed.

Explicit must and nice wording is resolved from each line and its nearest relevant heading. True duplicates are merged conservatively and stable IDs follow evidence order. A vague posting may produce zero requirements, questions, and flashcards with `THIN_JD` and `NO_EXPLICIT_REQUIREMENTS`. The role title is never converted into a skill requirement.

## Coverage and scheduling

Technical or domain requirements and behavioural requirements use separate calls. System-design questions require supported hiring material or a senior technical role. Company-fit questions require supported company content and a linkable behavioural or domain requirement.

After each call, code removes unknown and disallowed IDs, deduplicates links, caps them at three, requires meaningful lexical support, and drops questions with no valid link. Gap calls receive only uncovered requirements. The pass limit is three. Deterministic fallback questions cover every remaining real requirement. An uncovered must-have causes final validation to fail.

Schedule allocation is deterministic code. Must-linked and harder questions come first. Minutes are 10, 15, or 25 by difficulty, with deterministic flashcard review time. Questions are partitioned into exactly the requested days. Extra days become review days. An empty-question kit receives honest 30-minute brief and job-description review days without invented content.

## Rate limits and deadlines

One limiter is shared across concurrent cases with model buckets, RPM and TPM reservations, actual-usage reconciliation, cancellation, and deadline awareness. Each kit has a token budget. Provider 429 responses honor `Retry-After`; transient failures use bounded exponential backoff with jitter.

Optional summaries are reduced before correctness work. Deterministic flashcards and grounded fallback questions take over as needed. Grounding, coverage, schedule allocation, and final validation are never skipped. Degraded valid work is marked with `DEGRADED`.

## Editing and regeneration state

Questions and flashcards carry `origin`, `edited`, `pinned`, and `generated_by`. User, edited, pinned, and category-moved questions survive regeneration with stable IDs. Deleted generated text becomes a normalized tombstone so it cannot return. Company-brief edits survive per field. Coverage and schedule are recomputed after question regeneration.

## Failure behavior

- Invalid case input becomes a failed entry without stopping other cases.
- Unreachable sites produce honest partial-research kits.
- Missing hiring material produces `hiring_process: null` and `NO_HIRING_PAGE`.
- Model unavailability activates conservative extraction and deterministic generation.
- Foreign source URLs and requirement IDs are removed.
- Invalid references, day counts, or uncovered must-haves cause `KIT_INVALID`.
- An unreadable input, non-array document, or unusable output causes a nonzero run-level exit.

## Fixtures and tests

```sh
npm run fixtures
npm run evaluate -- --input fixtures/cases/sample.json --output kits.json
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

The fixture server defaults to `http://localhost:8099/` and tests use ephemeral ports. Normal tests use no public internet, database, or API key. They cover schemas, grounding, URL safety, fetching, robots, crawling, discussion filtering, model validation, limiting, category separation, coverage, fallbacks, regeneration, scheduling properties, practice ordering, pipeline invariants, and evaluator primitives.

The measured five-case fixture evaluation with Groq completed in 135 seconds and used 32,031 total model tokens. All five outputs passed schema, reference, exact-day, and must-have coverage validation.

## Known limitations

- Client-rendered sites without readable server HTML may yield sparse research.
- Hacker News coverage is sparse for small or non-technical companies.
- Sitemap declarations are hints; XML sitemap expansion is not performed.
- Evaluator checkpoints and caches last only for the current process.
