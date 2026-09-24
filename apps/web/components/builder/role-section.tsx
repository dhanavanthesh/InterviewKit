"use client";

import type { Kit, Requirement, RequirementKind, RequirementPriority } from "@interview-kit/schema";
import { useState, type FormEvent } from "react";
import { EditableText, ReorderButtons } from "../editable";
import { Button, Dialog, EmptyState, Notice } from "../ui";
import type { Writer } from "./kit-builder";

function moved<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(index + direction, 0, item);
  return next;
}

export function RoleSection({ kit, write }: { kit: Kit; write: Writer }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<RequirementKind>("technical");
  const [priority, setPriority] = useState<RequirementPriority>("must");
  const [addingResponsibility, setAddingResponsibility] = useState(false);
  const [responsibilityDraft, setResponsibilityDraft] = useState("");
  function open(requirement?: Requirement) {
    setEditing(requirement ?? null);
    setAdding(true);
    setError("");
    setText(requirement?.text ?? "");
    setKind(requirement?.kind ?? "technical");
    setPriority(requirement?.priority ?? "must");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await write(
        editing ? `/requirements/${editing.id}` : "/requirements",
        editing ? "PATCH" : "POST",
        { text, kind, priority },
      );
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save requirement.");
    }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this requirement and unlink it from questions and cards?")) return;
    try {
      await write(`/requirements/${id}`, "DELETE");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete requirement.");
    }
  }
  function reorder(index: number, direction: -1 | 1) {
    const ids = moved(kit.role.requirements, index, direction).map((item) => item.id);
    void write("/requirements/order", "PUT", { ordered_ids: ids }, (current) => {
      if (!current.kit) return current;
      const byId = new Map(current.kit.role.requirements.map((item) => [item.id, item]));
      return {
        ...current,
        kit: {
          ...current.kit,
          role: { ...current.kit.role, requirements: ids.map((id) => byId.get(id)!) },
        },
      };
    }).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not reorder."),
    );
  }
  function changeResponsibilities(responsibilities: string[]) {
    void write("/role", "PATCH", { responsibilities }).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not save responsibilities."),
    );
  }
  return (
    <div className="section-stack">
      <section className="surface">
        <h2>Role</h2>
        <div className="form-grid">
          <EditableText
            label="Title"
            value={kit.role.title}
            maxLength={300}
            save={(title) => write("/role", "PATCH", { title })}
          />
          <EditableText
            label="Seniority"
            value={kit.role.seniority}
            maxLength={200}
            save={(seniority) => write("/role", "PATCH", { seniority })}
          />
        </div>
      </section>
      <section className="surface">
        <div className="section-head">
          <h2>Responsibilities</h2>
          <Button variant="secondary" onClick={() => setAddingResponsibility(true)}>
            Add
          </Button>
        </div>
        {kit.role.responsibilities.length ? (
          <div className="simple-list">
            {kit.role.responsibilities.map((item, index) => (
              <div className="card" key={index}>
                <EditableText
                  label={`Responsibility ${index + 1}`}
                  value={item}
                  maxLength={1000}
                  save={(value) =>
                    write("/role", "PATCH", {
                      responsibilities: kit.role.responsibilities.map((entry, i) =>
                        i === index ? value : entry,
                      ),
                    })
                  }
                />
                <div className="actions">
                  <ReorderButtons
                    up={
                      index > 0
                        ? () => changeResponsibilities(moved(kit.role.responsibilities, index, -1))
                        : undefined
                    }
                    down={
                      index < kit.role.responsibilities.length - 1
                        ? () => changeResponsibilities(moved(kit.role.responsibilities, index, 1))
                        : undefined
                    }
                  />
                  <Button
                    variant="quiet"
                    onClick={() =>
                      changeResponsibilities(
                        kit.role.responsibilities.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No responsibilities listed">
            Add responsibilities you want to prepare for.
          </EmptyState>
        )}
      </section>
      {addingResponsibility && (
        <Dialog title="Add responsibility" onClose={() => setAddingResponsibility(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!responsibilityDraft.trim()) return;
              changeResponsibilities([...kit.role.responsibilities, responsibilityDraft.trim()]);
              setResponsibilityDraft("");
              setAddingResponsibility(false);
            }}
          >
            <div className="field">
              <label htmlFor="new-responsibility">Responsibility</label>
              <textarea
                id="new-responsibility"
                value={responsibilityDraft}
                onChange={(event) => setResponsibilityDraft(event.target.value)}
                required
                maxLength={1000}
              />
            </div>
            <Button type="submit">Add responsibility</Button>
          </form>
        </Dialog>
      )}
      <section className="surface">
        <div className="section-head">
          <h2>Requirements</h2>
          <Button variant="secondary" onClick={() => open()}>
            Add requirement
          </Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {kit.role.requirements.length ? (
          <div className="simple-list">
            {kit.role.requirements.map((item, index) => (
              <article className="card" key={item.id}>
                <div className="item-head">
                  <div>
                    <span className={`chip ${item.priority === "must" ? "chip-must" : ""}`}>
                      {item.priority === "must" ? "Must have" : "Nice to have"}
                    </span>
                    <span className="chip">{item.kind}</span>
                    <p className="item-copy">{item.text}</p>
                    {item.evidence && <p className="item-meta">JD evidence: {item.evidence}</p>}
                  </div>
                  <span className="item-meta">{item.id}</span>
                </div>
                <div className="actions">
                  <ReorderButtons
                    up={index > 0 ? () => reorder(index, -1) : undefined}
                    down={
                      index < kit.role.requirements.length - 1 ? () => reorder(index, 1) : undefined
                    }
                  />
                  <Button variant="quiet" onClick={() => open(item)}>
                    Edit
                  </Button>
                  <Button variant="quiet" onClick={() => void remove(item.id)}>
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No explicit requirements">
            The description did not support specific requirements. You can add your own.
          </EmptyState>
        )}
      </section>
      {adding && (
        <Dialog
          title={editing ? "Edit requirement" : "Add requirement"}
          onClose={() => setAdding(false)}
        >
          <form onSubmit={(event) => void save(event)}>
            <div className="field">
              <label htmlFor="requirement-text">Requirement</label>
              <textarea
                id="requirement-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
                maxLength={2000}
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="requirement-kind">Kind</label>
                <select
                  id="requirement-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as RequirementKind)}
                >
                  <option value="technical">Technical</option>
                  <option value="behavioural">Behavioural</option>
                  <option value="domain">Domain</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="requirement-priority">Priority</label>
                <select
                  id="requirement-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as RequirementPriority)}
                >
                  <option value="must">Must</option>
                  <option value="nice">Nice</option>
                </select>
              </div>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit">Save requirement</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
