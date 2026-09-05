import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { DecisionRequest } from "../../lib/contracts/decision";
import {
  calculateAuditHash,
  Repository,
} from "../../lib/db/repository";
import {
  DecisionTargetError,
  resolveDecisionTarget,
} from "../../lib/decisions/service";
import type { Signal } from "../../lib/contracts/signal";

const sourceRef = {
  source: "holdings.csv" as const,
  key: { instrument_id: "TEST-1" },
  fields: ["market_value_usd"],
  values: { market_value_usd: 100 },
};

async function createRepository() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = new Pool();
  await db.query(`
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE narratives (
      client_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      input_hash TEXT
    );
    CREATE TABLE audit_log (
      chain_seq BIGSERIAL UNIQUE NOT NULL,
      entry_id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      rm_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      before TEXT NOT NULL,
      after TEXT,
      reason_code TEXT,
      reason_text TEXT,
      confidence_at_decision INTEGER NOT NULL,
      prompt_version TEXT NOT NULL,
      model TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      context_pack_hash TEXT,
      source_refs TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
  `);
  return {
    db,
    repository: new Repository(db, { useAdvisoryLock: false }),
  };
}

test("decision contracts require modification instructions and controlled rejection reasons", () => {
  const base = {
    client_id: "CL-0001",
    target_type: "narrative_recommendation",
    target_id: "SIG-1",
  };
  assert.equal(
    DecisionRequest.safeParse({ ...base, action: "modify", instructions: " " })
      .success,
    false,
  );
  assert.equal(
    DecisionRequest.safeParse({
      ...base,
      action: "reject",
      reason_code: "not_a_controlled_reason",
    }).success,
    false,
  );
  assert.equal(
    DecisionRequest.safeParse({
      ...base,
      action: "reject",
      reason_code: "other",
    }).success,
    false,
  );
  assert.equal(
    DecisionRequest.safeParse({
      ...base,
      action: "accept",
      model: "forged-model",
    }).success,
    false,
  );
});

test("audit entries form a deterministic SHA-256 chain", async () => {
  const { db, repository } = await createRepository();
  const common = {
    rm_id: "RM-PO-0412",
    target_type: "narrative_recommendation" as const,
    target_id: "SIG-1",
    client_id: "CL-0001",
    before: { title: "Discuss portfolio" },
    confidence_at_decision: 72,
    prompt_version: "narrative-recommendation-v1",
    model: "gpt-4o",
    input_hash: "input-hash",
    context_pack_hash: null,
    source_refs: [sourceRef],
  };
  const first = await repository.appendAuditEntry({
    ...common,
    action: "accept",
    after: null,
    reason_code: null,
    reason_text: null,
  });
  const second = await repository.appendAuditEntry({
    ...common,
    action: "modify",
    after: { instructions: "Reduce scope" },
    reason_code: null,
    reason_text: null,
  });

  assert.equal(first.prev_hash, "0".repeat(64));
  assert.equal(second.prev_hash, first.hash);
  const secondWithoutHashes = Object.fromEntries(
    Object.entries(second).filter(
      ([key]) => key !== "prev_hash" && key !== "hash",
    ),
  );
  assert.equal(
    second.hash,
    calculateAuditHash(first.hash, secondWithoutHashes),
  );
  assert.equal(
    (await repository.getLatestDecision(
      "narrative_recommendation",
      "SIG-1",
      "CL-0001",
    ))?.action,
    "modify",
  );
  await db.end();
});

test("target resolution rejects a client ownership mismatch", async () => {
  const { db, repository } = await createRepository();
  const signal: Signal = {
    signal_id: "SIG-OWNER",
    client_id: "CL-0001",
    portfolio_ids: ["P-1"],
    type: "risk",
    subtype: "test",
    headline: "Test signal",
    window: { from: "2026-01-01", to: "2026-01-02" },
    magnitude_usd: 100,
    magnitude_pct: null,
    direction: "negative",
    urgency_score: 50,
    urgency_breakdown: { materiality: 50 },
    affected_holdings: [],
    evidence: [sourceRef],
    data_quality_flags: [],
    computed_at: "2026-01-02T00:00:00.000Z",
  };
  await db.query("INSERT INTO signals VALUES ($1, $2, $3)", [
    signal.signal_id,
    signal.client_id,
    JSON.stringify(signal),
  ]);
  await db.query("INSERT INTO narratives VALUES ($1, $2, $3)", [
    signal.client_id,
    JSON.stringify({
      [signal.signal_id]: {
        story: "Story",
        opening_line: "Opening",
        recommended_action: {
          title: "Discuss",
          rationale: "Grounded rationale",
          steps: ["Call client"],
          confidence: 70,
        },
        caveats: [],
        confidence: 70,
      },
    }),
    "persisted-hash",
  ]);

  await assert.rejects(
    async () => {
      await resolveDecisionTarget(
        repository,
        "narrative_recommendation",
        signal.signal_id,
        "CL-9999",
      );
    },
    (error: unknown) =>
      error instanceof DecisionTargetError && error.status === 403,
  );
  await db.end();
});
