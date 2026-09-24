import type { Kit } from "@interview-kit/schema";

import { ApiError } from "../errors";
import type { Repositories } from "../repositories/repository";
import type { KitRecord } from "../types";
import { validateEditableKit } from "./kit-validation";

export async function requireReadyKit(
  repositories: Repositories,
  ownerId: string,
  kitId: string,
): Promise<KitRecord & { kit: Kit }> {
  const record = await repositories.kits.findOwned(ownerId, kitId);
  if (record === null) throw new ApiError("NOT_FOUND", "The kit was not found.");
  if (record.status !== "ready" || record.kit === null)
    throw new ApiError("KIT_INVALID", "The kit is not ready.");
  return { ...record, kit: record.kit };
}

export async function mutateOwnedKit(
  repositories: Repositories,
  ownerId: string,
  kitId: string,
  mutation: (record: KitRecord & { kit: Kit }) => KitRecord,
): Promise<KitRecord & { kit: Kit }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await requireReadyKit(repositories, ownerId, kitId);
    const proposed = mutation(structuredClone(current));
    if (proposed.kit === null) throw new ApiError("KIT_INVALID", "The mutation removed the kit.");
    proposed.kit = validateEditableKit(proposed.kit);
    const saved = await repositories.kits.compareAndSwap(ownerId, kitId, current.version, proposed);
    if (saved) return { ...proposed, version: current.version + 1, kit: proposed.kit };
  }
  throw new ApiError("VERSION_CONFLICT", "The kit changed too many times. Retry the edit.");
}
