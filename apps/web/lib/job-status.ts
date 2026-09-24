import type { Job } from "./api";

export function isActiveJob(status: Job["status"] | undefined): boolean {
  return status === "queued" || status === "running";
}
