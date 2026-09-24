"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  type Coverage,
  type Job,
  type KitDetail,
  type RegenerateRequest,
} from "../../lib/api";
import { useKitWrites } from "../../lib/kit-writes";
import { isActiveJob } from "../../lib/job-status";
import { BackLink, Button, Dialog, Loading, Notice, StatusBadge } from "../ui";
import { BriefResearch } from "./brief-research";
import { RoleSection } from "./role-section";
import { QuestionSection } from "./question-section";
import { FlashcardSection } from "./flashcard-section";
import { ScheduleCoverage } from "./schedule-coverage";

export type Writer = ReturnType<typeof useKitWrites>["write"];
const tabs = [
  "Brief",
  "Role",
  "Questions",
  "Flashcards",
  "Schedule",
  "Coverage",
  "Research",
] as const;

export function KitBuilder({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const editor = useKitWrites(id);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busySection, setBusySection] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<RegenerateRequest | null>(null);
  const [message, setMessage] = useState("");
  const detail = useQuery({ queryKey: ["kit", id], queryFn: () => api<KitDetail>(`/kits/${id}`) });
  const coverage = useQuery({
    queryKey: ["coverage", id],
    queryFn: () => api<Coverage>(`/kits/${id}/coverage`),
    enabled: detail.data?.status === "ready",
  });
  const job = useQuery({
    queryKey: ["regeneration", jobId],
    queryFn: () => api<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (isActiveJob(query.state.data?.status) ? 1500 : false),
  });
  const currentTab = tabs.find((tab) => tab.toLowerCase() === params.get("tab")) ?? "Brief";
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["kit", id] });
    await client.invalidateQueries({ queryKey: ["coverage", id] });
  }
  useEffect(() => {
    if (!job.data || !busySection || !["done", "failed", "interrupted"].includes(job.data.status))
      return;
    setBusySection(null);
    void refresh();
    if (job.data.status !== "done")
      setMessage(
        job.data.error?.message ?? "Regeneration did not finish. Your existing content is safe.",
      );
  }, [job.data, busySection]);
  useEffect(() => {
    if (detail.data && !detail.data.kit) router.replace(`/kits/${id}/generating`);
  }, [detail.data, id, router]);
  async function regenerate(request: RegenerateRequest, confirmed = false) {
    await editor.flush();
    const kit = detail.data?.kit;
    if (!kit) return;
    if (
      !confirmed &&
      ((request.section === "schedule" && kit.schedule.edited) ||
        (request.section === "company_brief" &&
          (kit.company_brief.summary_edited || kit.company_brief.what_they_do_edited)))
    ) {
      setConfirm(request);
      return;
    }
    setMessage("");
    setBusySection(
      request.section === "questions" ? `questions:${request.category}` : request.section,
    );
    try {
      const response = await api<{ job_id?: string }>(`/kits/${id}/regenerate`, {
        method: "POST",
        body: JSON.stringify(
          request.section === "schedule" ? { ...request, confirm: confirmed } : request,
        ),
        headers: { "content-type": "application/json" },
      });
      if (response.job_id) setJobId(response.job_id);
      else {
        setBusySection(null);
        await refresh();
      }
    } catch (error) {
      setBusySection(null);
      setMessage(error instanceof Error ? error.message : "Regeneration failed.");
    }
  }
  if (detail.isPending) return <Loading label="Opening your kit…" />;
  if (detail.isError)
    return (
      <Notice tone="error">
        Could not open this kit.{" "}
        <Button variant="quiet" onClick={() => void detail.refetch()}>
          Try again
        </Button>
      </Notice>
    );
  if (!detail.data.kit) {
    return <Loading label="Opening generation progress…" />;
  }
  const kit = detail.data.kit;
  return (
    <>
      <div className="page-heading">
        <div>
          <BackLink href="/kits">All kits</BackLink>
          <h1>{kit.role.title || kit.source.role || "Interview kit"}</h1>
          <p>
            {kit.source.company || "Company not identified"} · {kit.schedule.days_available} days
          </p>
        </div>
        <Link href={`/kits/${id}/practice`} className="button button-primary">
          Practice flashcards
        </Link>
      </div>
      {message && <Notice tone="error">{message}</Notice>}
      {busySection && (
        <Notice>
          Regenerating {busySection.replaceAll(":", " ")}… Your other sections remain available.{" "}
          {job.data && <StatusBadge status={job.data.status} />}
        </Notice>
      )}
      <div className="tabs" role="tablist" aria-label="Kit sections">
        {tabs.map((tab) => (
          <button
            key={tab}
            className="tab"
            role="tab"
            aria-selected={currentTab === tab}
            onClick={() => router.replace(`?tab=${tab.toLowerCase()}`, { scroll: false })}
          >
            {tab}
          </button>
        ))}
      </div>
      {currentTab === "Brief" && (
        <BriefResearch
          kit={kit}
          write={editor.write}
          onRegenerate={() => void regenerate({ section: "company_brief" })}
          busy={busySection === "company_brief"}
          mode="brief"
        />
      )}
      {currentTab === "Role" && <RoleSection kit={kit} write={editor.write} />}
      {currentTab === "Questions" && (
        <QuestionSection
          kit={kit}
          write={editor.write}
          onRegenerate={(category) => void regenerate({ section: "questions", category })}
          busySection={busySection}
        />
      )}
      {currentTab === "Flashcards" && <FlashcardSection kit={kit} write={editor.write} />}
      {currentTab === "Schedule" && (
        <ScheduleCoverage
          kit={kit}
          coverage={coverage.data}
          write={editor.write}
          onRegenerate={() => void regenerate({ section: "schedule" })}
          busy={busySection === "schedule"}
          mode="schedule"
        />
      )}
      {currentTab === "Coverage" && (
        <ScheduleCoverage
          kit={kit}
          coverage={coverage.data}
          write={editor.write}
          onRegenerate={() => undefined}
          busy={false}
          mode="coverage"
        />
      )}
      {currentTab === "Research" && (
        <BriefResearch
          kit={kit}
          write={editor.write}
          onRegenerate={() => undefined}
          busy={false}
          mode="research"
        />
      )}
      {confirm && (
        <Dialog title="Replace this section?" onClose={() => setConfirm(null)}>
          <p>
            Your edited fields will be preserved where supported. A manually edited schedule will be
            replaced by a fresh allocation.
          </p>
          <div className="actions">
            <Button
              onClick={() => {
                const request = confirm;
                setConfirm(null);
                void regenerate(request, true);
              }}
            >
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
