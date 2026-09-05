import "server-only";

import { createHash, randomUUID } from "crypto";
import { getDb, withTransaction } from "../db/client";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export async function writeSecurityAuditEvent(input: {
  rmId?: string;
  eventType: string;
  target: string;
  clientId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await withTransaction(getDb(), async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["security-audit-log"],
    );
    const previous = (
      await client.query<{ hash: string }>(
        `SELECT hash
         FROM security_audit_log
         ORDER BY chain_seq DESC
         LIMIT 1`,
      )
    ).rows[0];
    const event = {
      event_id: randomUUID(),
      ts: new Date().toISOString(),
      rm_id: input.rmId ?? null,
      event_type: input.eventType,
      target: input.target,
      client_id: input.clientId ?? null,
      metadata: input.metadata ?? {},
    };
    const prevHash = previous?.hash ?? "0".repeat(64);
    const serialized = JSON.stringify(canonicalize(event));
    const hash = createHash("sha256")
      .update(`${prevHash}\n${serialized}`)
      .digest("hex");
    await client.query(
      `INSERT INTO security_audit_log
       (event_id, ts, rm_id, event_type, target, client_id, metadata, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.event_id,
        event.ts,
        event.rm_id,
        event.event_type,
        event.target,
        event.client_id,
        JSON.stringify(event.metadata),
        prevHash,
        hash,
      ],
    );
  });
}
