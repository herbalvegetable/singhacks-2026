import "server-only";

import { createHash, randomUUID } from "crypto";
import { getDb } from "../db/client";

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

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS security_audit_log (
      event_id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      rm_id TEXT,
      event_type TEXT NOT NULL,
      target TEXT NOT NULL,
      client_id TEXT,
      metadata TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
  `);
}

export function writeSecurityAuditEvent(input: {
  rmId?: string;
  eventType: string;
  target: string;
  clientId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): void {
  ensureTable();
  const db = getDb();
  const append = db.transaction(() => {
    const previous = db
      .prepare(
        "SELECT hash FROM security_audit_log ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { hash: string } | undefined;
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
    db.prepare(
      `INSERT INTO security_audit_log
       (event_id, ts, rm_id, event_type, target, client_id, metadata, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.event_id,
      event.ts,
      event.rm_id,
      event.event_type,
      event.target,
      event.client_id,
      JSON.stringify(event.metadata),
      prevHash,
      hash,
    );
  });
  append.immediate();
}
