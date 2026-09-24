"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, json, type User } from "../lib/api";
import { useServerReady } from "../lib/session";
import { Button, Field, Loading, Notice } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const health = useServerReady();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = params.get("next");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must have at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const user = await api<User>(`/auth/${mode}`, json("POST", { email, password }));
      client.setQueryData(["me"], user);
      router.replace(next?.startsWith("/kits") ? next : "/kits");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-card" aria-label={mode === "login" ? "Sign in" : "Create account"}>
        <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="auth-lead">
          {mode === "login"
            ? "Pick up your interview prep where you left off."
            : "Turn a job description into a prep plan you can edit and practise."}
        </p>
        {params.get("reason") === "session-expired" && (
          <Notice tone="error">Your session expired. Sign in again.</Notice>
        )}
        {health.isPending && <Loading label="Connecting to the server…" />}
        {health.isError && (
          <Notice tone="error">
            <strong>Server unavailable.</strong> It may take a moment to start.{" "}
            <Button variant="quiet" onClick={health.retryNow}>
              Try again
            </Button>
          </Notice>
        )}
        {health.slow && (
          <p className="muted" aria-live="polite">
            Starting the server. Free hosting can take a moment.
          </p>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <Field label="Email address" htmlFor="email">
            <input
              id="email"
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              value={password}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy || !health.isSuccess} className="wide">
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <Link href={mode === "login" ? "/register" : "/login"}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </section>
    </div>
  );
}
