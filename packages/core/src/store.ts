import type { PipelineCheckpoint, PipelineStore } from "./types";

export class InMemoryPipelineStore implements PipelineStore {
  private readonly checkpoints = new Map<string, PipelineCheckpoint>();

  save(checkpoint: PipelineCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.key, structuredClone(checkpoint));
    return Promise.resolve();
  }

  load(key: string): Promise<PipelineCheckpoint | undefined> {
    const checkpoint = this.checkpoints.get(key);
    return Promise.resolve(checkpoint === undefined ? undefined : structuredClone(checkpoint));
  }
}
