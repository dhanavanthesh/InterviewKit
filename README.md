# InterviewKit

InterviewKit turns a job description and company website into an evidence-grounded, editable interview preparation kit.

## Requirements

- Node.js 20
- npm 10 or later

## Installation

```sh
npm ci
```

## Development commands

```sh
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

The mandatory evaluator command is:

```sh
npm run evaluate -- --input <cases.json> --output <kits.json>
```

The evaluator entry point is reserved and currently reports that the generation pipeline will be delivered in the next implementation milestone.
