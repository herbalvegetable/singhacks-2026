import "server-only";

import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { getDb, withTransaction } from "../db/client";
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

function principalHash(request: NextRequest, rmId?: string): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return createHash("sha256")
    .update(`${rmId ?? "anonymous"}:${ip}`)
    .digest("hex");
}

export async function enforceRateLimit(
  request: NextRequest,
  options: {
    bucket: string;
    limit: number;
    windowMs: number;
    rmId?: string;
  },
): Promise<void> {
  const now = Date.now();
  const principal = principalHash(request, options.rmId);
  const lockKey = `rate-limit:${options.bucket}:${principal}`;
  await withTransaction(getDb(), async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      lockKey,
    ]);
    const current = (
      await client.query<{
        window_start: string | number;
        request_count: number;
      }>(
        `SELECT window_start, request_count
         FROM request_rate_limits
         WHERE bucket = $1 AND principal_hash = $2`,
        [options.bucket, principal],
      )
    ).rows[0];
    const evaluation = evaluateRateLimit(
      current
        ? {
            windowStart: Number(current.window_start),
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
    await client.query(
      `INSERT INTO request_rate_limits
       (bucket, principal_hash, window_start, request_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(bucket, principal_hash) DO UPDATE SET
         window_start = EXCLUDED.window_start,
         request_count = EXCLUDED.request_count`,
      [
        options.bucket,
        principal,
        evaluation.state.windowStart,
        evaluation.state.count,
      ],
    );
  });
}

export async function reserveDailyAiBudget(
  rmId: string,
  estimatedTokens: number,
): Promise<void> {
  const configured = Number(process.env.VERITY_DAILY_TOKEN_BUDGET ?? "100000");
  const dailyBudget =
    Number.isFinite(configured) && configured > 0 ? configured : 100_000;
  const usageDate = new Date().toISOString().slice(0, 10);
  const lockKey = `ai-budget:${usageDate}:${rmId}`;
  await withTransaction(getDb(), async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      lockKey,
    ]);
    const row = (
      await client.query<{ reserved_tokens: number }>(
        `SELECT reserved_tokens
         FROM ai_budget_usage
         WHERE usage_date = $1 AND rm_id = $2
         FOR UPDATE`,
        [usageDate, rmId],
      )
    ).rows[0];
    const next = (row?.reserved_tokens ?? 0) + estimatedTokens;
    if (next > dailyBudget) throw new BudgetExceededError();
    await client.query(
      `INSERT INTO ai_budget_usage (usage_date, rm_id, reserved_tokens)
       VALUES ($1, $2, $3)
       ON CONFLICT(usage_date, rm_id) DO UPDATE SET
         reserved_tokens = EXCLUDED.reserved_tokens`,
      [usageDate, rmId, next],
    );
  });
}

export async function acquireConcurrency(
  principal: string,
  limit: number,
  leaseMs = 5 * 60_000,
): Promise<() => Promise<void>> {
  const leaseId = randomUUID();
  const now = Date.now();
  await withTransaction(getDb(), async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `ai-concurrency:${principal}`,
    ]);
    await client.query(
      "DELETE FROM ai_concurrency_leases WHERE principal = $1 AND expires_at <= $2",
      [principal, now],
    );
    const active = Number(
      (
        await client.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM ai_concurrency_leases WHERE principal = $1",
          [principal],
        )
      ).rows[0]?.count ?? 0,
    );
    if (active >= limit) throw new RateLimitError(10);
    await client.query(
      `INSERT INTO ai_concurrency_leases (lease_id, principal, expires_at)
       VALUES ($1, $2, $3)`,
      [leaseId, principal, now + leaseMs],
    );
  });

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await getDb().query(
      "DELETE FROM ai_concurrency_leases WHERE lease_id = $1",
      [leaseId],
    );
  };
}
