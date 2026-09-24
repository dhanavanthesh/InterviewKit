# InterviewKit

InterviewKit turns a job description, company website, and interview date into a practical preparation kit. It researches public company material, extracts evidence-backed requirements, creates focused questions and flashcards, closes coverage gaps, and builds an exact-day study schedule.

## What it includes

- Evidence-grounded requirement extraction
- Bounded company and hiring-process research
- Categorized questions, flashcards, coverage, and scheduling
- Email and password authentication
- Reopenable, owner-isolated kits
- Builder operations and safe section regeneration
- Confidence-based practice sessions
- A standalone batch evaluator

## Stack

TypeScript, Node.js 20, Express, MongoDB with Mongoose, Zod, Groq, Vitest, Supertest, and npm workspaces.

```text
apps/api          Express API, authentication, jobs and persistence
packages/schema   Shared Zod contracts
packages/logic    Coverage, scheduling, merge and practice rules
packages/core     Retrieval and generation pipeline
scripts           Batch evaluator
fixtures          Local evaluation sites and sample cases
```

The API and evaluator both call the same `runPipeline` implementation. Persistence and HTTP concerns remain outside the generation core.

## Setup

You need Node.js 20, npm 10 or later, and a Groq key for model-assisted generation. The local MongoDB command below starts a database on your machine.

```sh
npm ci
copy .env.example .env
```

Configure the API values in `.env`:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/interview-kit
SESSION_SECRET=replace-with-at-least-32-random-characters
WEB_ORIGIN=http://localhost:3000
GROQ_API_KEY=
```

In one terminal, start local MongoDB. Its data stays in the ignored `tmp/mongodb` directory between runs. In another terminal, start the API:

```sh
npm run mongo:local
npm run dev:api
```

Health: `GET http://localhost:3001/api/health`

## Batch evaluator

The evaluator requires no MongoDB or API server:

```sh
npm run evaluate -- --input <cases.json> --output <kits.json>
```

```json
[
  {
    "id": "case-01",
    "jd": "Senior Backend Engineer\nRequirements\n- TypeScript experience is required.",
    "company_url": "https://example.com",
    "days": 5
  }
]
```

The output contains an `ok` or `failed` result for every input ID. Individual failures do not stop the batch. Without a Groq key, conservative extraction and deterministic fallbacks remain available.

## Generation pipeline

1. Validate the job description, URL, and requested days.
2. Extract role details and candidate requirements.
3. Ground every requirement against the job description.
4. Crawl a small set of relevant company pages under robots and URL-safety rules.
5. Find supported hiring details and public interview discussion.
6. Build a sourced company brief.
7. Generate each question category independently.
8. Validate links and calculate coverage in code.
9. Generate gap-only questions, then grounded fallbacks when needed.
10. Build flashcards, allocate exactly the requested days, and validate the kit.

Groq drafts structured content. Code owns grounding, priority corrections, stable IDs, allowed sources, coverage, fallback questions, scheduling, and final validity.

## Retrieval safety

The crawler accepts only HTTP and HTTPS, rejects embedded credentials, validates resolved addresses, pins connections to validated addresses, and rechecks redirects. Production blocks loopback, private, link-local, metadata, CGNAT, multicast, reserved, and local IPv6 destinations.

Requests use strict timeout, retry, redirect, content-type, byte, page, depth, and total-research limits. Robots rules are respected. Fetched pages and pasted descriptions are always treated as untrusted content.

Public interview discussion uses the Hacker News Algolia API and requires an exact company identity plus interview-related terms. Missing research becomes an honest partial result.

## Authentication and ownership

Passwords are bcrypt-hashed. Sessions use a seven-day HS256 JWT in an `httpOnly`, `SameSite=Lax` cookie. Production cookies are `Secure`. Logout increments the token version and revokes existing sessions.

Every kit, job, and practice query includes the authenticated owner ID. Missing and foreign resources return the same `404 NOT_FOUND` response.

## Jobs and duplicate handling

Kit creation returns `202` with kit and job IDs. A bounded in-process worker runs the shared pipeline and stores progress for `GET /api/jobs/:id`.

Duplicate submissions are keyed by owner, normalized description, normalized company URL, and days. Running or ready duplicates return the existing resource. `force: true` starts a separate kit. Failed and interrupted jobs can be retried. On startup, unfinished jobs are marked `interrupted`.

## Builder and regeneration

All builder writes use one compare-and-swap mutation service. It reloads on version conflicts, recomputes truthful coverage, repairs the schedule, validates the kit, and retries a bounded number of times.

Generated kits cannot contain uncovered must-have requirements. User-edited kits may contain real gaps after a question is changed or removed, and the coverage endpoint reports those gaps honestly.

User-created, edited, pinned, and moved questions survive category regeneration. Deleted generated prompts become tombstones. Regeneration merges into the latest kit version, so edits made while regeneration runs are preserved.

## Practice

Practice sessions prioritize unseen cards and low confidence, then older reviews. A requirement is ready when all of its current cards have confidence of at least three.

## API

```text
POST   /api/auth/register        POST   /api/auth/login
POST   /api/auth/logout          GET    /api/auth/me

POST   /api/kits                 POST   /api/kits/batch
GET    /api/kits                 GET    /api/kits/:id
DELETE /api/kits/:id             GET    /api/jobs/:id
POST   /api/jobs/:id/retry

PATCH  /api/kits/:id/company-brief
PATCH  /api/kits/:id/role
POST   /api/kits/:id/requirements
PATCH  /api/kits/:id/requirements/:rid
DELETE /api/kits/:id/requirements/:rid
POST   /api/kits/:id/questions
PATCH  /api/kits/:id/questions/:qid
DELETE /api/kits/:id/questions/:qid
PUT    /api/kits/:id/questions/order
POST   /api/kits/:id/flashcards
PATCH  /api/kits/:id/flashcards/:fid
DELETE /api/kits/:id/flashcards/:fid
PUT    /api/kits/:id/flashcards/order
PATCH  /api/kits/:id/schedule/days/:day
GET    /api/kits/:id/coverage
POST   /api/kits/:id/regenerate
GET    /api/kits/:id/practice/session
POST   /api/kits/:id/practice/reviews
GET    /api/kits/:id/practice/progress
```

All errors use one shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is invalid.",
    "details": {}
  }
}
```

## Quality checks

```sh
npm test
npm run test:api
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Normal tests use no public internet, production database, or API key. API tests use injected repositories and a deterministic pipeline executor.

## Deployment

`render.yaml` defines the API service.

- Build: `npm ci && npm run build:api`
- Start: `node apps/api/dist/server.js`
- Health check: `/api/health`
- Runtime: Node.js 20

Set `MONGODB_URI`, `SESSION_SECRET`, `WEB_ORIGIN`, and `GROQ_API_KEY` in the hosting dashboard. Do not upload `.env`. Production startup rejects missing values and disables private-host crawling.

## Known limitations

- The in-process queue marks unfinished work interrupted after a restart.
- Client-rendered sites may provide little readable server HTML.
- Public discussion can be sparse for small or non-technical companies.
- XML sitemap files are not expanded beyond discovered hints.
