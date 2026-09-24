"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, type KitListItem } from "../../lib/api";
import { Button, Dialog, EmptyState, Loading, Notice, StatusBadge } from "../../components/ui";

export default function KitsPage() {
  const query = useQuery({ queryKey: ["kits"], queryFn: () => api<KitListItem[]>("/kits") });
  const client = useQueryClient();
  const [deleting, setDeleting] = useState<KitListItem | null>(null);
  const [error, setError] = useState("");
  async function remove() {
    if (!deleting) return;
    try {
      await api<void>(`/kits/${deleting.id}`, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: ["kits"] });
      setDeleting(null);
    } catch {
      setError("Could not delete the kit. Please try again.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Interview kits</h1>
          <p>Your interview preparation in one place.</p>
        </div>
        <Link href="/kits/new" className="button button-primary">
          Create a kit
        </Link>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice tone="error">
          Could not load your kits.{" "}
          <Button variant="quiet" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Notice>
      ) : query.data.length === 0 ? (
        <EmptyState title="No kits yet">
          <p>Add a job description and company website to build your first kit.</p>
          <Link className="button button-primary" href="/kits/new">
            Create your first kit
          </Link>
        </EmptyState>
      ) : (
        <div className="kit-list">
          {query.data.map((kit) => (
            <article className="kit-row" key={kit.id}>
              <div>
                <h2>{kit.company || "Company research pending"}</h2>
                <p>{kit.role || "Interview preparation"}</p>
              </div>
              <StatusBadge status={kit.status} />
              <span className="kit-row-meta">
                {kit.days} day{kit.days === 1 ? "" : "s"} · Updated{" "}
                {new Date(kit.updated_at).toLocaleDateString()}
              </span>
              <div className="kit-row-actions">
                <Link
                  href={kit.status === "ready" ? `/kits/${kit.id}` : `/kits/${kit.id}/generating`}
                  className="button button-quiet"
                >
                  {kit.status === "ready" ? "Open" : "Progress"}
                </Link>
                <Button
                  variant="quiet"
                  className="icon-button"
                  aria-label={`Delete ${kit.company || "kit"}`}
                  title="Delete kit"
                  onClick={() => setDeleting(kit)}
                >
                  ×
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {deleting && (
        <Dialog title="Delete this kit?" onClose={() => setDeleting(null)}>
          <p>This removes the kit, its jobs, and your practice history. This cannot be undone.</p>
          <div className="actions">
            <Button variant="danger" onClick={() => void remove()}>
              Delete kit
            </Button>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
