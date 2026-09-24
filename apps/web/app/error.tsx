"use client";
import { Button } from "../components/ui";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Something went wrong</h1>
      <p>Your work is still saved. Try loading this page again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
