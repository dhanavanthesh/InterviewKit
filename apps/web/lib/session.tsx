"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type User } from "./api";

export function useServerReady() {
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(timer);
  }, [attempt]);
  const query = useQuery({
    queryKey: ["health", attempt],
    queryFn: () => api<{ ok: boolean }>("/health"),
    retry: 3,
    retryDelay: (count) => Math.min(1000 * 2 ** count, 4000),
    staleTime: 60_000,
  });
  return {
    ...query,
    slow: slow && query.isPending,
    retryNow: () => setAttempt((value) => value + 1),
  };
}

export function useSession() {
  const router = useRouter();
  const health = useServerReady();
  const user = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    enabled: health.isSuccess,
    retry: false,
  });
  useEffect(() => {
    if (user.isError) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?reason=session-expired&next=${encodeURIComponent(next)}`);
    }
  }, [router, user.isError]);
  return { health, user };
}

export function useLogout() {
  const router = useRouter();
  const client = useQueryClient();
  return async function logout() {
    try {
      await api<void>("/auth/logout", { method: "POST" });
    } finally {
      client.clear();
      router.replace("/login");
    }
  };
}
