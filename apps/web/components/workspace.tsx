"use client";

import type { PropsWithChildren } from "react";
import { useSession } from "../lib/session";
import { Button, Loading, Notice } from "./ui";

export function Workspace({ children }: PropsWithChildren) {
  const { health, user } = useSession();
  if (health.isPending || user.isPending)
    return (
      <>
        <Loading label="Loading…" />
        {health.slow && (
          <p className="muted" aria-live="polite">
            Starting the server. Free hosting can take a moment.
          </p>
        )}
      </>
    );
  if (health.isError)
    return (
      <Notice tone="error">
        The server is unavailable.{" "}
        <Button variant="quiet" onClick={health.retryNow}>
          Try again
        </Button>
      </Notice>
    );
  if (user.isError) return <Loading label="Returning to sign in…" />;
  return <>{children}</>;
}
