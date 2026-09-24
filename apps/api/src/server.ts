import { validateUrl } from "@interview-kit/core";

import { createApp } from "./app";
import { closeDatabase, connectDatabase } from "./db";
import { loadApiEnvironment } from "./env";
import { ApiError } from "./errors";
import { createPipelineExecutor } from "./pipeline-executor";
import { createMongooseRepositories } from "./repositories/mongoose";
import { JobRunner } from "./services/job-runner";

async function main(): Promise<void> {
  const environment = loadApiEnvironment();
  await connectDatabase(environment.mongoUri);
  const repositories = createMongooseRepositories();
  const jobs = new JobRunner(
    repositories,
    createPipelineExecutor(environment),
    environment.jobConcurrency,
  );
  await jobs.recover();
  const app = createApp({
    repositories,
    jobs,
    environment,
    async validateCompanyUrl(value) {
      await validateUrl(value, { allowPrivateHosts: environment.pipeline.allowPrivateHosts });
    },
  });
  const server = app.listen(environment.port, () => {
    console.log(`API listening on port ${environment.port}.`);
  });
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message =
    error instanceof ApiError &&
    /^(Missing|Invalid) environment variables: [A-Z_, ]+\.$/.test(error.message)
      ? error.message
      : "API startup failed. Check the required environment and database connection.";
  console.error(message);
  process.exitCode = 1;
});
