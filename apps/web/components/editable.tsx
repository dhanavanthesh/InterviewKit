"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { SaveState } from "./ui";

export function EditableText({
  label,
  value,
  save,
  multiline = false,
  maxLength = 5000,
}: {
  label: string;
  value: string;
  save: (value: string) => Promise<unknown>;
  multiline?: boolean;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => {
    setDraft(value);
  }, [value]);
  async function persist() {
    if (draft === value) return;
    setState("saving");
    try {
      await save(draft);
      setState("saved");
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="field">
      <label>{label}</label>
      {multiline ? (
        <textarea
          aria-label={label}
          value={draft}
          maxLength={maxLength}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void persist()}
          rows={4}
        />
      ) : (
        <input
          aria-label={label}
          value={draft}
          maxLength={maxLength}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void persist()}
        />
      )}
      <SaveState state={state} />
      {state === "failed" && (
        <button className="button button-quiet" onClick={() => void persist()}>
          Retry save
        </button>
      )}
    </div>
  );
}

export function ReorderButtons({
  up,
  down,
  item = "item",
}: {
  up?: (() => void) | undefined;
  down?: (() => void) | undefined;
  item?: string;
}) {
  return (
    <span className="inline-actions">
      <button
        className="button button-quiet icon-button"
        type="button"
        aria-label={`Move ${item} up`}
        title={`Move ${item} up`}
        onClick={up}
        disabled={!up}
      >
        ↑
      </button>
      <button
        className="button button-quiet icon-button"
        type="button"
        aria-label={`Move ${item} down`}
        title={`Move ${item} down`}
        onClick={down}
        disabled={!down}
      >
        ↓
      </button>
    </span>
  );
}

// Reads as plain text until clicked, then edits in place; blur or Ctrl+Enter saves, Escape cancels.
export function InlineText({
  label,
  value,
  save,
  as: Tag = "p",
  className = "",
  placeholder = "Click to add text",
  required = false,
  maxLength = 5000,
}: {
  label: string;
  value: string;
  save: (value: string) => Promise<unknown>;
  as?: "h3" | "p";
  className?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [failedText, setFailedText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);
  useLayoutEffect(() => {
    const element = area.current;
    if (!editing || !element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft, editing]);
  useEffect(() => {
    if (editing) {
      area.current?.focus();
      area.current?.setSelectionRange(area.current.value.length, area.current.value.length);
    }
  }, [editing]);

  async function commit(text = draft) {
    setEditing(false);
    const next = text.trim();
    if (next === value.trim() || (required && next.length === 0)) {
      setDraft(value);
      setState("idle");
      return;
    }
    setState("saving");
    try {
      await save(next);
      setState("saved");
    } catch {
      setFailedText(next);
      setDraft(next);
      setState("failed");
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void commit();
    }
  }

  const shown = state === "failed" ? failedText : value;
  return (
    <div className={`inline-edit ${editing ? "is-editing" : ""}`}>
      {editing ? (
        <textarea
          ref={area}
          aria-label={label}
          className={`inline-input ${className}`}
          value={draft}
          maxLength={maxLength}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
        />
      ) : (
        <Tag
          className={`inline-view ${className} ${shown ? "" : "is-empty"}`}
          role="button"
          tabIndex={0}
          aria-label={`${label}: ${shown || "empty"}. Press Enter to edit.`}
          title="Click to edit"
          onClick={() => {
            setDraft(shown);
            setEditing(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setDraft(shown);
              setEditing(true);
            }
          }}
        >
          {shown || placeholder}
        </Tag>
      )}
      {editing ? (
        <span className="inline-hint">Ctrl+Enter to save, Esc to cancel</span>
      ) : (
        state !== "idle" && (
          <span className="inline-status">
            <SaveState state={state} />
            {state === "failed" && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => void commit(failedText)}
              >
                Retry save
              </button>
            )}
          </span>
        )
      )}
    </div>
  );
}
