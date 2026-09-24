<div align="center">

<img src="apps/web/public/interviewkit-mark.png" alt="InterviewKit logo" width="72" height="72" />

# InterviewKit

**Turn a job description into an interview prep kit you can edit and practise.**

Grounded requirements, company research, categorised questions, flashcards and an exact-day schedule.

[![CI](https://github.com/dhanavanthesh/InterviewKit/actions/workflows/ci.yml/badge.svg)](https://github.com/dhanavanthesh/InterviewKit/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-20-339933.svg)](.nvmrc)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

[Quick start](#quick-start) · [Batch evaluator](#batch-evaluator) · [How it works](#how-it-works) ·
[Design decisions](#design-decisions) · [Edge cases](#edge-cases) · [Deployment](#deployment)

Paste a posting, give the company website and the days you have. InterviewKit crawls the company
site for what they do and how they hire, searches public interview discussion, and builds a kit
through separate, checkable steps. Code, not the model, decides what counts as a requirement,
what is covered, and what happens on each day.

## Why InterviewKit?

A single prompt invents requirements and quietly skips some. Here every requirement must point
at the line it came from, and priority follows the posting's own wording:

```text
Requirements
- Strong experience with PostgreSQL and query performance tuning
Nice to have
- Mentoring junior engineers
```

```json
[
  {
    "id": "r1",
    "text": "Strong experience with PostgreSQL and query performance tuning",
    "kind": "technical",
    "priority": "must",
    "evidence": "Strong experience with PostgreSQL and query performance tuning"
  },
  {
    "id": "r2",
    "text": "Mentoring junior engineers",
    "kind": "behavioural",
    "priority": "nice",
    "evidence": "Mentoring junior engineers"
  }
]
```

`r1` is sent to the technical question call and `r2` to the behavioural one. A posting with no
explicit requirements produces an empty list and a `NO_EXPLICIT_REQUIREMENTS` warning, never a
skill guessed from the job title.

## What the model does not decide

| Decision                                               | Owner |
| ------------------------------------------------------ | ----- |
| Whether a requirement's evidence exists in the posting | Code  |
| Must or nice when the posting says so                  | Code  |
| Stable IDs, allowed sources, requirement links         | Code  |
| Which requirements are covered                         | Code  |
| Fallback questions after the last gap pass             | Code  |
| Allocation of questions across days                    | Code  |
| Batch `ok` versus `failed`                             | Code  |
| Drafting text inside strict JSON schemas               | Model |

## Quick start

Requires Node.js 20 and npm 10+. A free [Groq](https://console.groq.com) key enables generation.

```bash
npm ci
cp .env.example .env        # set GROQ_API_KEY and SESSION_SECRET (32+ random characters)
```

Two terminals:

```bash
cd apps/api && npm run dev  # starts local MongoDB, waits for it, then the API on :3001
cd apps/web && npm run dev  # web app on :3000
```

Or one: `npm run dev` from the repository root. Open `http://localhost:3000`.
Local database files stay in the ignored `tmp/mongodb` folder.

## Batch evaluator

Runs the same pipeline as the app, without MongoDB or the API:

```bash
npm ci
cp .env.example .env        # only GROQ_API_KEY is needed
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Input is an array of `{ id, jd, company_url, days }`. Output is one JSON document with an entry per
case. A case you could only partly research is `ok` with warnings; `failed` is kept for cases with
no valid kit. One failing case never stops the run, and results are written after every case.

To try the bundled cases, start the local fixture sites first:

```bash
npm run fixtures            # serves sample company sites on localhost:8099
npm run evaluate -- --input fixtures/cases/sample.json --output kits.json
```

The five sample cases finished in **193.6 s** with 33,723 model tokens in the last verification
run. Every kit passed schema, reference, coverage and exact-day checks.

## How it works

```text
paste JD ----> extract requirements -> ground in JD (code) ------------------+
company URL -> URL + robots checks -> crawl and rank links -> hiring page    |
                                   -> public discussion -> sourced brief     |
                                                                             v
            plan categories (code) -> one call per category -> link check (code)
            -> find gaps (code) -> gap-only questions, up to 3 passes -> fallbacks (code)
            -> flashcards -> schedule (code) -> validate kit -> save or write
```

| Step     | Responsibility                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Extract  | Role, responsibilities and candidate requirements with verbatim evidence                                  |
| Ground   | Keep only requirements whose evidence appears in the posting; set priority from its wording               |
| Crawl    | Rank links by anchor text, path and headings to find about, careers, handbook or process pages            |
| Research | Hiring stages only when supported by page text; public discussion from Hacker News                        |
| Generate | Separate instructions per category; a found take-home or system design round adds system-design questions |
| Cover    | Recompute gaps in code after each pass until no must-have is uncovered                                    |
| Schedule | Allocate every question across exactly the requested days                                                 |

The pasted posting needs no retrieval, so extraction starts at once while research runs in
parallel. Models are `openai/gpt-oss-120b` for extraction and questions and `openai/gpt-oss-20b`
for briefs, hiring stages and flashcards, both through Groq's free tier with strict structured
output.

## Design decisions

**Generated, edited and pinned state.** Every question and flashcard carries `origin`
(`generated` or `user`), `edited` and `pinned`. Regenerating a category replaces only untouched
generated items. User-written, edited, pinned and moved items keep their IDs and order, and
deleted generated prompts are remembered so they do not return. The merge runs against the
latest saved version, so an edit made during regeneration survives.

**Coverage passes.** Up to three gap-only passes: the second targets just the gaps, the third
absorbs one failed call. More passes spend rate-limit budget that other cases need. Anything still
uncovered gets a grounded fallback question built from the requirement text, so a generated kit
never ships with an uncovered must-have.

**Schedule.** Questions are ordered by must-have first, then difficulty, then category, and split
into exactly N contiguous days that balance minutes (10, 15 or 25 per question). Harder,
higher-priority material lands first. With more days than questions, the extra days become review
days; with no questions, days stay honest review days rather than invented content.

**Practice ordering.** A confidence-weighted sort: unseen and least-confident cards first, then
the oldest review. It is predictable and explainable, and spaced-repetition intervals add little
when the interview is days away.

**Rate limits.** One limiter is shared by all concurrent work, with a bucket per model for requests
and tokens per minute. Every request, including retries and schema repairs, reserves tokens and is
reconciled with reported usage. 429 and 5xx responses back off with jitter and honour
`retry-after`. When time or budget runs short, optional steps are dropped first and the kit stays
`ok` with a `DEGRADED` warning.

**Slow, failed or repeated generation.** Creating a kit returns `202` and runs in a background job
that stores progress after each step, so a 90-second run can be left and reopened. A failure keeps
its steps and error and can be retried. A repeated submission of the same posting, company and days
returns the existing job or kit.

## Retrieval and sources

- **Company site.** Crawled within the same registrable domain, depth 2 (one level deeper from hiring pages), at most 10 pages and 45 s.
  No hard-coded careers paths. `robots.txt`, `noindex` and `nofollow` are respected; login, search
  and legal pages are skipped.
- **Public discussion.** [Hacker News Search API](https://hn.algolia.com/api), filtered to results
  naming the company alongside interview terms. Sites whose terms forbid automated access, such as
  Glassdoor or LinkedIn, are not used.
- Every page is logged as used, skipped, failed or blocked, and sources in the kit are limited to
  pages actually fetched.

## Edge cases

| Situation                          | Result                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Invalid URL, 404 or timeout        | Kit built from the posting, honest brief, `COMPANY_UNREACHABLE` |
| No hiring or about page            | `hiring_process: null`, no invented rounds, `NO_HIRING_PAGE`    |
| Two-line posting                   | Only grounded requirements, `THIN_JD`                           |
| No public discussion               | `discussion: null`, `NO_PUBLIC_DISCUSSION`                      |
| Invalid or incomplete model output | One repair attempt, then code fallbacks                         |
| Provider rate limit or outage      | Backoff with `retry-after`, then a degraded but valid kit       |
| Same posting submitted twice       | Existing job or kit returned                                    |
| 1-day or 60-day schedule           | Exactly that many days                                          |

## Security

Only HTTP and HTTPS URLs without credentials are fetched. Resolved addresses are validated and
pinned, redirects are rechecked, and production blocks private, loopback, link-local and metadata
addresses. Responses are limited by content type, size and time. The posting, crawled pages and
discussion text are passed to the model as data, never as instructions, and outputs must pass
schema, grounding and source checks.

Passwords are bcrypt-hashed. Sessions use an `httpOnly`, `SameSite=Lax` cookie, `Secure` in
production, revoked on sign-out. Every kit, job and practice query is scoped to its owner, and
another user's resource returns `404`.

## Architecture

```text
apps/web          Next.js + Tailwind: builder, practice, generation progress
apps/api          Express: auth, owner scoping, jobs, persistence (MongoDB)
packages/schema   Zod contracts for the kit and batch formats
packages/logic    Coverage, schedule, merge and practice rules (browser-safe)
packages/core     Retrieval, extraction, generation and the shared pipeline
scripts           Batch evaluator and local dev helpers
fixtures          Local company sites, sample postings and cases
```

The web app calls `/api/*` on its own origin and Next.js forwards it to the API, which keeps the
session cookie first-party. The API job runner and the evaluator both call the same `runPipeline`.

<details>
<summary>API routes</summary>

```text
POST   /api/auth/register              POST   /api/auth/login
POST   /api/auth/logout                GET    /api/auth/me
POST   /api/kits                       POST   /api/kits/batch
GET    /api/kits                       GET    /api/kits/:id
GET    /api/kits/:id/job               DELETE /api/kits/:id
GET    /api/jobs/:id                   POST   /api/jobs/:id/retry
PATCH  /api/kits/:id/company-brief     PATCH  /api/kits/:id/role
POST   /api/kits/:id/requirements      PATCH  /api/kits/:id/requirements/:rid
DELETE /api/kits/:id/requirements/:rid PUT    /api/kits/:id/requirements/order
POST   /api/kits/:id/questions         PATCH  /api/kits/:id/questions/:qid
DELETE /api/kits/:id/questions/:qid    PUT    /api/kits/:id/questions/order
POST   /api/kits/:id/flashcards        PATCH  /api/kits/:id/flashcards/:fid
DELETE /api/kits/:id/flashcards/:fid   PUT    /api/kits/:id/flashcards/order
PATCH  /api/kits/:id/schedule/days/:day
GET    /api/kits/:id/coverage          POST   /api/kits/:id/regenerate
GET    /api/kits/:id/practice/session  POST   /api/kits/:id/practice/reviews
GET    /api/kits/:id/practice/progress GET    /api/health
```

Errors share one shape: `{ "error": { "code", "message", "details" } }`.

</details>

## Deployment

API on Render (`render.yaml`), web on Vercel (project root `apps/web`), database on MongoDB Atlas.
All free tiers. Set `API_ORIGIN` in Vercel before the first build. Free Render instances sleep, so
the first request can take a moment; the web app shows a wake-up state and retries.

| Variable                                   | Used by        | Purpose                                                       |
| ------------------------------------------ | -------------- | ------------------------------------------------------------- |
| `GROQ_API_KEY`                             | API, evaluator | Model access                                                  |
| `GROQ_MODEL_MAIN`, `GROQ_MODEL_LIGHT`      | API, evaluator | Models for heavy and light steps                              |
| `LLM_RPM`, `LLM_TPM`                       | API, evaluator | Per-model request and token limits (free-tier defaults)       |
| `LLM_KIT_TOKEN_BUDGET`, `LLM_MAX_PASSES`   | API, evaluator | Token budget per kit, coverage passes                         |
| `ALLOW_PRIVATE_HOSTS`                      | API, evaluator | Allow local sites; forced off in production                   |
| `CRAWL_*`, `RESEARCH_TIMEOUT_MS`           | API, evaluator | Crawl pages, timeouts, byte cap, user agent                   |
| `EVAL_CONCURRENCY`, `EVAL_RUN_DEADLINE_MS` | Evaluator      | Parallel cases and whole-run deadline                         |
| `MONGODB_URI`, `SESSION_SECRET`            | API            | Database and cookie signing                                   |
| `WEB_ORIGIN`, `TRUST_PROXY_HOPS`, `PORT`   | API            | Allowed origin, proxy hops for rate limits, port              |
| `API_JOB_CONCURRENCY`                      | API            | Parallel generation jobs                                      |
| `API_ORIGIN`                               | Web            | Where `/api/*` is forwarded                                   |
| `NODE_ENV`                                 | All            | `production` enables secure cookies and private-host blocking |

## Development

```bash
npm test                    # all tests; no API key or running database needed
npm run lint
npm run typecheck
npm run format:check
npm run build
```

The MongoDB persistence test downloads its database binary on first run; every other test runs
offline. Tests cover the kit and batch schemas, schedule properties, coverage, grounding and priority rules,
regeneration merge, URL safety, crawling, rate limiting, the full pipeline on local fixture sites,
the evaluator, owner isolation, and builder interactions.

## Known limitations

- The job queue runs in process; a restart marks unfinished jobs as interrupted and retryable.
- Sites that render only in the browser may yield little readable text.
- Public discussion is sparse for small or non-technical companies.
- A single-day schedule with many questions can be long, because every question is allocated.

## License

[MIT](LICENSE)
