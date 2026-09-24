"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Job, type KitDetail } from "../../../../lib/api";
import { isActiveJob } from "../../../../lib/job-status";
import { Button, Loading, Notice, StatusBadge } from "../../../../components/ui";

export default function GeneratingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const kit = useQuery({
    queryKey: ["kit", id],
    queryFn: () => api<KitDetail>(`/kits/${id}`),
    refetchInterval: (query) => (query.state.data?.status === "generating" ? 1500 : false),
  });
  const job = useQuery({
    queryKey: ["kit-job", id],
    queryFn: () => api<Job | null>(`/kits/${id}/job`),
    refetchInterval: (query) => (isActiveJob(query.state.data?.status) ? 1500 : false),
  });
  useEffect(() => {
    if (kit.data?.status === "ready") router.replace(`/kits/${id}`);
  }, [id, kit.data?.status, router]);
  async function retry() {
    if (!job.data) return;
    setRetrying(true);
    try {
      await api(`/jobs/${job.data.id}/retry`, { method: "POST" });
      await job.refetch();
      await kit.refetch();
    } finally {
      setRetrying(false);
    }
  }
  if (kit.isPending || job.isPending) return <Loading label="Checking generation progress…" />;
  if (kit.isError || job.isError)
    return (
      <Notice tone="error">
        Could not load progress.{" "}
        <Button
          variant="quiet"
          onClick={() => {
            void kit.refetch();
            void job.refetch();
          }}
        >
          Try again
        </Button>
      </Notice>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Generating kit</h1>
          <p>You can leave this page and return at any time. Your progress is saved.</p>
        </div>
        <StatusBadge status={job.data?.status ?? kit.data.status} />
      </div>
      {job.data?.error && <Notice tone="error">{job.data.error.message}</Notice>}
      {job.data && ["failed", "interrupted"].includes(job.data.status) && (
        <Button onClick={() => void retry()} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry generation"}
        </Button>
      )}
      <section className="surface" style={{ marginTop: 20 }}>
        <div className="section-head">
          <h2>Progress</h2>
          <Link href="/kits">Back to kits</Link>
        </div>
        {!job.data?.steps.length ? (
          <Loading label="Starting research and extraction…" />
        ) : (
          <>
            <div className="gen-hero">
              <div className="gen-meter">
                <span>
                  <strong>
                    {job.data.steps.filter((step) => step.status !== "running").length} of{" "}
                    {job.data.steps.length} steps complete
                  </strong>
                  {" · "}
                  {job.data.steps.find((step) => step.status === "running")?.message ??
                    (job.data.status === "done" ? "Your kit is ready" : "Working")}
                </span>
              </div>
              <div
                className="meter"
                role="progressbar"
                aria-label="Generation progress"
                aria-valuemin={0}
                aria-valuemax={job.data.steps.length}
                aria-valuenow={job.data.steps.filter((step) => step.status !== "running").length}
              >
                <span
                  style={{
                    width: `${(job.data.steps.filter((step) => step.status !== "running").length / job.data.steps.length) * 100}%`,
                  }}
                />
              </div>
            </div>
            <ol className="progress-list" aria-live="polite">
              {job.data.steps.map((step, index) => (
                <li
                  key={`${step.step}-${index}`}
                  className={step.status === "running" ? "is-running" : undefined}
                >
                  <StatusBadge status={step.status} />
                  <div>
                    <strong>{step.step.replaceAll("_", " ").replaceAll(":", ": ")}</strong>
                    <span className="muted">{step.message}</span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </>
  );
}
