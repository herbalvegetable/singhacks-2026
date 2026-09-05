import "server-only";

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getDb } from "../db/client";
import { evaluateRateLimit } from "./rateLimitPolicy";

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests");
  }
}

export class BudgetExceededError extends Error {
  constructor() {
    super("Daily AI budget exceeded");
  }
}

function ensureTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS request_rate_limits (
      bucket TEXT NOT NULL,
      principal_hash TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      PRIMARY KEY (bucket, principal_hash)
    );
    CREATE TABLE IF NOT EXISTS ai_budget_usage (
      usage_date TEXT NOT NULL,
      rm_id TEXT NOT NULL,
      reserved_tokens INTEGER NOT NULL,
      PRIMARY KEY (usage_date, rm_id)
    );
  `);
}

function principalHash(request: NextRequest, rmId?: string): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return createHash("sha256")
    .update(`${rmId ?? "anonymous"}:${ip}`)
    .digest("hex");
}

export function enforceRateLimit(
  request: NextRequest,
  options: {
    bucket: string;
    limit: number;
    windowMs: number;
    rmId?: string;
  },
): void {
  ensureTables();
  const now = Date.now();
  const principal = principalHash(request, options.rmId);
  const update = getDb().transaction(() => {
    const current = getDb()
      .prepare(
        `SELECT window_start, request_count
         FROM request_rate_limits
         WHERE bucket = ? AND principal_hash = ?`,
      )
      .get(options.bucket, principal) as
      | { window_start: number; request_count: number }
      | undefined;
    const evaluation = evaluateRateLimit(
      current
        ? {
            windowStart: current.window_start,
            count: current.request_count,
          }
        : null,
      now,
      options.limit,
      options.windowMs,
    );
    if (!evaluation.allowed) {
      throw new RateLimitError(evaluation.retryAfterSeconds);
    }
    getDb()
      .prepare(
        `INSERT INTO request_rate_limits
         (bucket, principal_hash, window_start, request_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(bucket, principal_hash) DO UPDATE SET
           window_start = excluded.window_start,
           request_count = excluded.request_count`,
      )
      .run(
        options.bucket,
        principal,
        evaluation.state.windowStart,
        evaluation.state.count,
      );
  });
  update.immediate();
}

export function reserveDailyAiBudget(
  rmId: string,
  estimatedTokens: number,
): void {
  ensureTables();
  const configured = Number(process.env.VERITY_DAILY_TOKEN_BUDGET ?? "100000");
  const dailyBudget =
    Number.isFinite(configured) && configured > 0 ? configured : 100_000;
  const usageDate = new Date().toISOString().slice(0, 10);
  const reserve = getDb().transaction(() => {
    const row = getDb()
      .prepare(
        "SELECT reserved_tokens FROM ai_budget_usage WHERE usage_date = ? AND rm_id = ?",
      )
      .get(usageDate, rmId) as { reserved_tokens: number } | undefined;
    const next = (row?.reserved_tokens ?? 0) + estimatedTokens;
    if (next > dailyBudget) throw new BudgetExceededError();
    getDb()
      .prepare(
        `INSERT INTO ai_budget_usage (usage_date, rm_id, reserved_tokens)
         VALUES (?, ?, ?)
         ON CONFLICT(usage_date, rm_id) DO UPDATE SET
           reserved_tokens = excluded.reserved_tokens`,
      )
      .run(usageDate, rmId, next);
  });
  reserve.immediate();
}

const activeByPrincipal = new Map<string, number>();

export function acquireConcurrency(
  principal: string,
  limit: number,
): () => void {
  const active = activeByPrincipal.get(principal) ?? 0;
  if (active >= limit) throw new RateLimitError(10);
  activeByPrincipal.set(principal, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = Math.max(0, (activeByPrincipal.get(principal) ?? 1) - 1);
    if (next === 0) activeByPrincipal.delete(principal);
    else activeByPrincipal.set(principal, next);
  };
}
