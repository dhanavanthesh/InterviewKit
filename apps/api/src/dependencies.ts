import type { ApiEnvironment } from "./env";
import type { Repositories } from "./repositories/repository";
import type { JobRunner } from "./services/job-runner";

export interface ApiDependencies {
  repositories: Repositories;
  jobs: JobRunner;
  environment: ApiEnvironment;
  validateCompanyUrl(value: string): Promise<void>;
}
