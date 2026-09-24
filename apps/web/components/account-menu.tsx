"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type User } from "../lib/api";
import { useLogout } from "../lib/session";

export function AccountMenu() {
  const user = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user.data) return null;
  const email = user.data.email;
  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${email}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {email.charAt(0).toUpperCase()}
        </span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="account-panel" role="menu" aria-label="Account">
          <div className="account-who">
            <span className="avatar avatar-lg" aria-hidden="true">
              {email.charAt(0).toUpperCase()}
            </span>
            <div>
              <span className="account-caption">Signed in as</span>
              <span className="account-email" title={email}>
                {email}
              </span>
            </div>
          </div>
          <button
            ref={item}
            type="button"
            role="menuitem"
            className="account-item"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6 3H3.5v10H6M10.5 5l3 3-3 3M13.5 8H6.5"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
