"use client";

import type { Kit } from "@interview-kit/schema";
import { EditableText } from "../editable";
import { Button, EmptyState, SourceLinks, StatusBadge } from "../ui";
import type { Writer } from "./kit-builder";

export function BriefResearch({
  kit,
  write,
  onRegenerate,
  busy,
  mode,
}: {
  kit: Kit;
  write: Writer;
  onRegenerate: () => void;
  busy: boolean;
  mode: "brief" | "research";
}) {
  if (mode === "brief")
    return (
      <div className="section-stack">
        <div className="section-stack">
          <section className="surface">
            <div className="section-head">
              <h2>Company brief</h2>
              <Button variant="secondary" onClick={onRegenerate} disabled={busy}>
                {busy ? "Regenerating…" : "Regenerate brief"}
              </Button>
            </div>
            <EditableText
              label="Summary"
              value={kit.company_brief.summary}
              multiline
              save={(summary) => write("/company-brief", "PATCH", { summary })}
            />
            <EditableText
              label="What they do"
              value={kit.company_brief.what_they_do}
              multiline
              save={(what_they_do) => write("/company-brief", "PATCH", { what_they_do })}
            />
            <h3>Sources</h3>
            <SourceLinks urls={kit.company_brief.sources} />
          </section>
          <section className="surface">
            <h2>Hiring process</h2>
            {kit.hiring_process ? (
              <>
                <ol>
                  {kit.hiring_process.stages.map((stage, index) => (
                    <li key={`${stage}-${index}`}>{stage}</li>
                  ))}
                </ol>
                <p>{kit.hiring_process.notes}</p>
                <SourceLinks urls={kit.hiring_process.sources} />
              </>
            ) : (
              <p className="muted">
                No supported interview-process details were found. No rounds have been assumed.
              </p>
            )}
          </section>
        </div>
      </div>
    );
  return (
    <div className="section-stack">
      <section className="surface">
        <h2>Pages used</h2>
        <SourceLinks urls={kit.source.pages_used} />
      </section>
      <section className="surface">
        <h2>Research log</h2>
        {kit.research_log?.length ? (
          <div className="simple-list">
            {kit.research_log.map((entry, index) => (
              <article className="card" key={`${entry.url}-${index}`}>
                <div className="item-head">
                  <a href={entry.url} target="_blank" rel="noreferrer">
                    {entry.url}
                  </a>
                  <StatusBadge status={entry.status} />
                </div>
                <p className="muted">{entry.reason}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No page log available">
            Company research may have been unavailable.
          </EmptyState>
        )}
      </section>
      <section className="surface">
        <h2>Public discussion</h2>
        {kit.discussion ? (
          <>
            <p>{kit.discussion.summary}</p>
            <SourceLinks urls={kit.discussion.sources} />
          </>
        ) : (
          <p className="muted">No relevant public interview discussion was found.</p>
        )}
      </section>
      <section className="surface">
        <h2>Warnings</h2>
        {kit.warnings?.length ? (
          <ul>
            {kit.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <strong>{warning.code.replaceAll("_", " ")}</strong>: {warning.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No research warnings.</p>
        )}
      </section>
    </div>
  );
}
