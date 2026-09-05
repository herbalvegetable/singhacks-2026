"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Unable to sign in.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      <div>
        <label
          htmlFor="username"
          className="text-xs font-bold uppercase tracking-[0.16em] text-slate/58"
        >
          Relationship Manager
        </label>
        <input
          id="username"
          name="username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          placeholder="Username"
          className="mt-2 w-full rounded-2xl border border-white/70 bg-white/62 px-4 py-3 text-sm font-semibold text-navy shadow-inner outline-none transition focus:border-lagoon/55 focus:bg-white/80 focus:ring-4 focus:ring-lagoon/12"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="text-xs font-bold uppercase tracking-[0.16em] text-slate/58"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          placeholder="Password"
          className="mt-2 w-full rounded-2xl border border-white/70 bg-white/62 px-4 py-3 text-sm font-semibold text-navy shadow-inner outline-none transition focus:border-lagoon/55 focus:bg-white/80 focus:ring-4 focus:ring-lagoon/12"
        />
      </div>

      {error && (
        <p className="rounded-2xl border border-risk-high/25 bg-risk-high/10 px-4 py-3 text-sm font-semibold text-risk-high">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="vibrant-button w-full rounded-2xl px-5 py-3 text-sm font-bold text-white"
      >
        {submitting ? "Signing in…" : "Log in to Verity"}
      </button>
    </form>
  );
}
