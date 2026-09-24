// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSession } from "../lib/session";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
});

it("redirects an expired session and preserves the intended page", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/health")
          ? new Response(JSON.stringify({ ok: true }))
          : new Response(
              JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "Expired" } }),
              {
                status: 401,
              },
            ),
      ),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useSession(), { wrapper });
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("/login?reason=session-expired&next="),
    ),
  );
});
