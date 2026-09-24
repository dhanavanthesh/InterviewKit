"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError, json, type BatchRow, type KitCreation } from "../../../lib/api";
import { Button, Field, Notice } from "../../../components/ui";
import { validateRole, type RoleInput } from "../../../lib/validation";

const emptyRole = (): RoleInput => ({ jd: "", company_url: "", days: 5 });

export default function NewKitPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<RoleInput[]>([emptyRole()]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [result, setResult] = useState<BatchRow[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicate, setDuplicate] = useState<KitCreation | null>(null);
  function change(index: number, update: Partial<RoleInput>) {
    setRoles((current) => current.map((role, i) => (i === index ? { ...role, ...update } : role)));
  }
  async function upload(fileToSend: File, defaultDays?: number) {
    const data = new FormData();
    data.set("file", fileToSend);
    if (defaultDays !== undefined) data.set("default_days", String(defaultDays));
    setResult(await api<BatchRow[]>("/kits/batch", { method: "POST", body: data }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setResult(null);
    const nextErrors: Record<number, string> = {};
    roles.forEach((role, index) => {
      const error = validateRole(role);
      if (error) nextErrors[index] = error;
    });
    setErrors(nextErrors);
    if (!file && roles.length === 1 && nextErrors[0]) return;
    setBusy(true);
    try {
      if (file) {
        if (file.size > 1_048_576 || !file.name.toLowerCase().endsWith(".json"))
          throw new Error("Choose a JSON file under 1 MB.");
        await upload(file, roles[0]?.days);
      } else if (roles.length === 1) {
        const created = await api<KitCreation>("/kits", json("POST", roles[0]));
        if (created.existing) setDuplicate(created);
        else
          router.push(
            created.status === "ready"
              ? `/kits/${created.kit_id}`
              : `/kits/${created.kit_id}/generating`,
          );
      } else {
        await upload(new File([JSON.stringify(roles)], "roles.json", { type: "application/json" }));
      }
    } catch (cause) {
      setMessage(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "Could not start the kit.",
      );
    } finally {
      setBusy(false);
    }
  }
  function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setResult(null);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Create a kit</h1>
          <p>
            Paste the job description as written. We only use requirements supported by that text.
          </p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="section-stack">
          {roles.map((role, index) => (
            <section className="row-card" key={index}>
              <div className="section-head">
                <h2>Role {index + 1}</h2>
                {roles.length > 1 && (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => setRoles((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <Field
                label="Job description"
                htmlFor={`jd-${index}`}
                hint={`${role.jd.length.toLocaleString()} / 30,000 characters`}
              >
                <textarea
                  id={`jd-${index}`}
                  rows={10}
                  value={role.jd}
                  maxLength={30_000}
                  onChange={(event) => change(index, { jd: event.target.value })}
                  placeholder="Paste the full posting here"
                />
              </Field>
              <div className="form-grid">
                <Field label="Company website" htmlFor={`url-${index}`}>
                  <input
                    id={`url-${index}`}
                    type="url"
                    value={role.company_url}
                    onChange={(event) => change(index, { company_url: event.target.value })}
                    placeholder="https://company.com"
                  />
                </Field>
                <Field label="Days until interview" htmlFor={`days-${index}`}>
                  <input
                    id={`days-${index}`}
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={role.days}
                    onChange={(event) => change(index, { days: Number(event.target.value) })}
                  />
                </Field>
              </div>
              {errors[index] && <Notice tone="error">{errors[index]}</Notice>}
            </section>
          ))}
          <div className="actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setRoles((current) => (current.length < 50 ? [...current, emptyRole()] : current))
              }
              disabled={roles.length >= 50}
            >
              Add another role
            </Button>
          </div>
          <section className="upload-option">
            <h2>Upload JSON instead</h2>
            <p className="muted">
              Up to 50 roles, 1 MB. Each row needs a job description, company URL and days. Valid
              rows continue even if another row has an error.
            </p>
            <Field label="JSON file" htmlFor="batch-file">
              <input
                id="batch-file"
                type="file"
                accept=".json,application/json"
                onChange={fileChanged}
              />
            </Field>
          </section>
          {message && <Notice tone="error">{message}</Notice>}
          {duplicate && (
            <Notice>
              <strong>This kit already exists.</strong>
              <div className="actions">
                <a
                  className="button button-secondary"
                  href={
                    duplicate.status === "ready"
                      ? `/kits/${duplicate.kit_id}`
                      : `/kits/${duplicate.kit_id}/generating`
                  }
                >
                  Open existing kit
                </a>
                <Button
                  type="button"
                  onClick={() => {
                    setBusy(true);
                    void api<KitCreation>("/kits", json("POST", { ...roles[0], force: true }))
                      .then((created) => router.push(`/kits/${created.kit_id}/generating`))
                      .catch((cause: unknown) =>
                        setMessage(
                          cause instanceof Error ? cause.message : "Could not create a fresh kit.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Generate fresh copy
                </Button>
              </div>
            </Notice>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Starting…" : file || roles.length > 1 ? "Start kits" : "Create kit"}
          </Button>
        </div>
      </form>
      {result && (
        <section className="upload-option" style={{ marginTop: 24 }}>
          <h2>Upload results</h2>
          <ul>
            {result.map((row) => (
              <li key={row.row}>
                Row {row.row + 1}:{" "}
                {row.error ? (
                  <span className="field-error">{row.error.message}</span>
                ) : (
                  <a href={`/kits/${row.kit_id}/generating`}>Open generation progress</a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
