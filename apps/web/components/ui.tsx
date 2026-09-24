"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from "react";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
}) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function Field({
  label,
  error,
  children,
  htmlFor,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  htmlFor: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status status-${status.replaceAll("_", "-")}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function Notice({
  children,
  tone = "info",
}: PropsWithChildren<{ tone?: "info" | "error" | "success" }>) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button
            ref={close}
            className="button button-quiet"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SaveState({ state }: { state: "idle" | "saving" | "saved" | "failed" }) {
  return (
    <span className={`save-state save-${state}`} role="status" aria-live="polite">
      {state === "idle"
        ? ""
        : state === "saving"
          ? "Saving…"
          : state === "saved"
            ? "Saved"
            : "Save failed"}
    </span>
  );
}

export function SourceLinks({ urls }: { urls: string[] }) {
  return urls.length ? (
    <ul className="source-list">
      {urls.map((url) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">No public source available.</p>
  );
}

export function BackLink({ href, children }: PropsWithChildren<{ href: string }>) {
  return (
    <Link href={href} className="back-link">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M10 3.5 5.5 8l4.5 4.5"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  );
}
