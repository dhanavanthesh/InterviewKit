"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api, json, type KitDetail } from "./api";

export function useKitWrites(kitId: string) {
  const client = useQueryClient();
  const pending = useRef<Promise<void>>(Promise.resolve());
  const key = ["kit", kitId];
  function write<T>(
    path: string,
    method: string,
    body?: unknown,
    optimistic?: (current: KitDetail) => KitDetail,
  ): Promise<T> {
    const operation = pending.current
      .catch(() => undefined)
      .then(async () => {
        const before = client.getQueryData<KitDetail>(key);
        if (before && optimistic) client.setQueryData(key, optimistic(before));
        try {
          const response = await api<T>(
            `/kits/${kitId}${path}`,
            body === undefined ? { method } : json(method, body),
          );
          await client.invalidateQueries({ queryKey: key });
          await client.invalidateQueries({ queryKey: ["coverage", kitId] });
          return response;
        } catch (error) {
          if (before && optimistic) client.setQueryData(key, before);
          throw error;
        }
      });
    pending.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
  return { write, flush: () => pending.current };
}
