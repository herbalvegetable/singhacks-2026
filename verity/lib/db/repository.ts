import type Database from "better-sqlite3";
import { createHash, randomUUID } from "crypto";
import { getDb } from "./client";
import { Grounding, type Signal } from "../contracts/signal";
import type { DiversificationPlan } from "../contracts/diversification";
import type { StoredRiskPriority } from "../contracts/priority";
import {
  AuditEntry,
  type AppendAuditEntryInput,
  type DecisionTargetType,
} from "../contracts/decision";

const GENESIS_HASH = "0".repeat(64);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function calculateAuditHash(
  previousHash: string,
  entryWithoutHashes: unknown,
): string {
  return createHash("sha256")
    .update(`${previousHash}\n${canonicalJson(entryWithoutHashes)}`)
    .digest("hex");
}

export interface Client {
  client_id: string;
  client_name: string;
  rm_id?: string;
  rm_name?: string;
  age: number | null;
  tax_domicile: string;
  objectives: string;
  life_stage: string;
  risk_profile: string;
  risk_tolerance_score: number;
  investment_horizon_years: number;
  liquidity_needs: string;
  total_aum_usd: number;
  // ... other fields
}

export interface Holding {
  snapshot_date: string;
  portfolio_id: string;
  client_id: string;
  instrument_id: string;
  instrument_name: string;
  asset_class: string;
  sub_asset_class: string;
  sector: string;
  region: string;
  instrument_ccy: string;
  quantity: number;
  price_local: number;
  market_value_usd: number;
  weight_pct: number;
  cost_basis_base: number | null;
  unrealised_pnl_base: number | null;
  unrealised_pnl_pct: number | null;
  liquidity_tier: string;
  advance_rate_pct: number;
}

export interface Instrument {
  instrument_id: string;
  instrument_name: string;
  asset_class: string;
  sub_asset_class: string;
  sector: string;
  region: string;
  currency: string;
  liquidity_tier: string;
  underlying_reference: string | null;
  concentration_limit_applies: string;
  sustainability_excluded: string;
}

export interface Transaction {
  transaction_id: string;
  trade_date: string;
  portfolio_id: string;
  transaction_type: string;
  instrument_id: string | null;
  quantity: number | null;
  amount: number;
  narrative: string;
}

export interface Mandate {
  mandate_code: string;
  mandate_name: string;
  asset_class: string;
  min_pct: number;
  target_pct: number;
  max_pct: number;
  max_single_position_pct: number;
  mandate_notes: string;
}

export interface Portfolio {
  portfolio_id: string;
  client_id: string;
  portfolio_name: string;
  mandate_code: string;
  mandate_name: string;
  service_model: string;
}

export interface FacilitySnapshot {
  facility_id: string;
  snapshot_date: string;
  drawn: number;
  collateral_market_value: number;
  lending_value: number;
  ltv_pct: number;
  headroom: number;
}

export interface CreditFacility {
  facility_id: string;
  client_id: string;
  collateral_portfolio_id: string;
  margin_call_ltv_pct: number;
  facility_ccy: string;
}

export interface RmNote {
  note_id: string;
  client_id: string;
  note_date: string;
  channel: string;
  note: string;
}

export interface CashNeed {
  need_id: string;
  client_id: string;
  description: string;
  currency: string;
  amount: number;
  due_from: string;
  due_to: string;
  certainty: string;
}

export interface Commitment {
  commitment_id: string;
  client_id: string;
  portfolio_id: string;
  fund_name: string;
  currency: string;
  uncalled: number;
  expected_call_window: string;
}

export interface MarketContext {
  snapshot_date: string;
  series_id: string;
  series_name: string;
  category: string;
  unit: string;
  value: number;
  snapshot_label: string;
}

export interface InstrumentPrice {
  instrument_id: string;
  snapshot_date: string;
  price: number;
}

export interface MarketEvent {
  event_id: string;
  event_date: string;
  event_type: string;
  region: string;
  description: string;
  primary_transmission: string;
  severity: string;
  transmission_tokens: string;
}

export class Repository {
  private db: Database.Database;

  constructor(database: Database.Database = getDb()) {
    this.db = database;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS diversification_plans (
        plan_id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_diversification_signal
        ON diversification_plans(signal_id, generated_at);
      CREATE TABLE IF NOT EXISTS groundings (
        signal_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        input_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS priorities (
        run_id TEXT,
        rank INTEGER,
        client_id TEXT,
        payload TEXT,
        PRIMARY KEY (run_id, client_id)
      );
      CREATE TABLE IF NOT EXISTS audit_log (
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
      CREATE INDEX IF NOT EXISTS idx_audit_target_latest
        ON audit_log(target_type, target_id, client_id, ts DESC);
    `);
  }

  getClient(clientId: string): Client | undefined {
    return this.db
      .prepare("SELECT * FROM clients WHERE client_id = ?")
      .get(clientId) as Client | undefined;
  }

  getAllClients(): Client[] {
    return this.db.prepare("SELECT * FROM clients").all() as Client[];
  }

  getClientsForRm(rmId: string): Client[] {
    return this.db
      .prepare("SELECT * FROM clients WHERE rm_id = ? ORDER BY client_name")
      .all(rmId) as Client[];
  }

  clientBelongsToRm(clientId: string, rmId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM clients WHERE client_id = ? AND rm_id = ?")
        .get(clientId, rmId),
    );
  }

  signalBelongsToRm(signalId: string, rmId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1
           FROM signals s
           INNER JOIN clients c ON c.client_id = s.client_id
           WHERE s.signal_id = ? AND c.rm_id = ?`,
        )
        .get(signalId, rmId),
    );
  }

  getHoldingsForClient(clientId: string, snapshotDate: string): Holding[] {
    return this.db
      .prepare(
        `SELECT * FROM holdings 
         WHERE client_id = ? AND snapshot_date = ?
         ORDER BY market_value_usd DESC`
      )
      .all(clientId, snapshotDate) as Holding[];
  }

  getHoldingsForPortfolio(
    portfolioId: string,
    snapshotDate: string
  ): Holding[] {
    return this.db
      .prepare(
        `SELECT * FROM holdings 
         WHERE portfolio_id = ? AND snapshot_date = ?
         ORDER BY market_value_usd DESC`
      )
      .all(portfolioId, snapshotDate) as Holding[];
  }

  getHoldingHistory(
    portfolioId: string,
    instrumentId: string
  ): Holding[] {
    return this.db
      .prepare(
        `SELECT * FROM holdings 
         WHERE portfolio_id = ? AND instrument_id = ?
         ORDER BY snapshot_date`
      )
      .all(portfolioId, instrumentId) as Holding[];
  }

  getInstrument(instrumentId: string): Instrument | undefined {
    return this.db
      .prepare("SELECT * FROM instruments WHERE instrument_id = ?")
      .get(instrumentId) as Instrument | undefined;
  }

  getInstruments(instrumentIds: string[]): Instrument[] {
    if (instrumentIds.length === 0) return [];
    const placeholders = instrumentIds.map(() => "?").join(", ");
    return this.db
      .prepare(`SELECT * FROM instruments WHERE instrument_id IN (${placeholders})`)
      .all(...instrumentIds) as Instrument[];
  }

  getTransactionsInWindow(
    portfolioId: string,
    from: string,
    to: string
  ): Transaction[] {
    return this.db
      .prepare(
        `SELECT * FROM transactions 
         WHERE portfolio_id = ? 
         AND trade_date >= ? AND trade_date <= ?
         ORDER BY trade_date`
      )
      .all(portfolioId, from, to) as Transaction[];
  }

  getMandatesForCode(mandateCode: string): Mandate[] {
    return this.db
      .prepare("SELECT * FROM mandates WHERE mandate_code = ?")
      .all(mandateCode) as Mandate[];
  }

  getPortfoliosForClient(clientId: string): Portfolio[] {
    return this.db
      .prepare("SELECT * FROM portfolios WHERE client_id = ?")
      .all(clientId) as Portfolio[];
  }

  getFacilitySnapshots(facilityId: string): FacilitySnapshot[] {
    return this.db
      .prepare(
        `SELECT * FROM facility_snapshots 
         WHERE facility_id = ?
         ORDER BY snapshot_date`
      )
      .all(facilityId) as FacilitySnapshot[];
  }

  getFacilitiesForClient(clientId: string): CreditFacility[] {
    return this.db
      .prepare("SELECT * FROM credit_facilities WHERE client_id = ?")
      .all(clientId) as CreditFacility[];
  }

  getSignalsForClient(clientId: string): Signal[] {
    const rows = this.db
      .prepare("SELECT payload FROM signals WHERE client_id = ?")
      .all(clientId) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as Signal);
  }

  getSignal(signalId: string): Signal | undefined {
    const row = this.db
      .prepare("SELECT payload FROM signals WHERE signal_id = ?")
      .get(signalId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Signal) : undefined;
  }

  getNarrativesForClient(clientId: string): Record<string, unknown> {
    const row = this.db
      .prepare("SELECT payload FROM narratives WHERE client_id = ?")
      .get(clientId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
  }

  getNarrativeArtifact(
    clientId: string,
    signalId: string,
  ): { narrative: unknown; input_hash: string } | undefined {
    const row = this.db
      .prepare("SELECT payload, input_hash FROM narratives WHERE client_id = ?")
      .get(clientId) as { payload: string; input_hash: string | null } | undefined;
    if (!row) return undefined;
    const narratives = JSON.parse(row.payload) as Record<string, unknown>;
    if (!(signalId in narratives)) return undefined;
    let inputHashes: Record<string, string> = {};
    try {
      inputHashes = JSON.parse(row.input_hash ?? "{}");
    } catch {
      inputHashes = {};
    }
    return {
      narrative: narratives[signalId],
      input_hash: inputHashes[signalId] ?? "",
    };
  }

  getRmNotesForClient(clientId: string): RmNote[] {
    return this.db
      .prepare(
        `SELECT note_id, client_id, note_date, channel, note
         FROM rm_notes WHERE client_id = ? ORDER BY note_date DESC`
      )
      .all(clientId) as RmNote[];
  }

  getTransactionsForClient(clientId: string, limit = 50): Transaction[] {
    return this.db
      .prepare(
        `SELECT * FROM transactions WHERE client_id = ?
         ORDER BY trade_date DESC LIMIT ?`
      )
      .all(clientId, limit) as Transaction[];
  }

  getCashNeedsForClient(clientId: string): CashNeed[] {
    return this.db
      .prepare(
        `SELECT * FROM planned_cash_needs WHERE client_id = ?
         ORDER BY due_from`
      )
      .all(clientId) as CashNeed[];
  }

  getCommitmentsForClient(clientId: string): Commitment[] {
    return this.db
      .prepare(
        `SELECT * FROM commitments WHERE client_id = ?
         ORDER BY expected_call_window`
      )
      .all(clientId) as Commitment[];
  }

  getClientDataQualityFlags(clientId: string): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT DISTINCT dq.*
         FROM data_quality_flags dq
         LEFT JOIN portfolios p
           ON dq.scope_id = p.portfolio_id
           OR dq.scope_id LIKE p.portfolio_id || ':%'
         LEFT JOIN holdings h
           ON dq.scope_id = h.instrument_id
           OR dq.scope_id LIKE '%:' || h.instrument_id
         WHERE dq.scope_id = ?
            OR p.client_id = ?
            OR h.client_id = ?`
      )
      .all(clientId, clientId, clientId) as Record<string, unknown>[];
  }

  getDataQualityFlags(scopeId: string): Record<string, unknown>[] {
    return this.db
      .prepare(
        "SELECT * FROM data_quality_flags WHERE scope_id LIKE ?"
      )
      .all(`%${scopeId}%`) as Record<string, unknown>[];
  }

  getSnapshotDates(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT snapshot_date FROM holdings ORDER BY snapshot_date`
      )
      .all() as { snapshot_date: string }[];
    return rows.map((r) => r.snapshot_date);
  }

  getMarketContext(snapshotDates?: string[]): MarketContext[] {
    if (!snapshotDates || snapshotDates.length === 0) {
      return this.db
        .prepare("SELECT * FROM market_context ORDER BY snapshot_date, series_id")
        .all() as MarketContext[];
    }
    const placeholders = snapshotDates.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT * FROM market_context WHERE snapshot_date IN (${placeholders})
         ORDER BY snapshot_date, series_id`,
      )
      .all(...snapshotDates) as MarketContext[];
  }

  getInstrumentPrices(instrumentIds: string[]): InstrumentPrice[] {
    if (instrumentIds.length === 0) return [];
    const placeholders = instrumentIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT * FROM instrument_prices WHERE instrument_id IN (${placeholders})
         ORDER BY instrument_id, snapshot_date`,
      )
      .all(...instrumentIds) as InstrumentPrice[];
  }

  getEvents(): MarketEvent[] {
    return this.db
      .prepare("SELECT * FROM events ORDER BY event_date")
      .all() as MarketEvent[];
  }

  getGrounding(signalId: string, inputHash?: string): Grounding | undefined {
    const row = inputHash
      ? (this.db
          .prepare(
            `SELECT payload FROM groundings
             WHERE signal_id = ? AND input_hash = ?`,
          )
          .get(signalId, inputHash) as { payload: string } | undefined)
      : (this.db
          .prepare("SELECT payload FROM groundings WHERE signal_id = ?")
          .get(signalId) as { payload: string } | undefined);
    return row ? Grounding.parse(JSON.parse(row.payload)) : undefined;
  }

  getGroundingsForClient(clientId: string): Grounding[] {
    const rows = this.db
      .prepare(
        `SELECT g.payload
         FROM groundings g
         INNER JOIN signals s ON s.signal_id = g.signal_id
         WHERE s.client_id = ?`,
      )
      .all(clientId) as Array<{ payload: string }>;
    return rows.map((row) => Grounding.parse(JSON.parse(row.payload)));
  }

  saveGrounding(grounding: Grounding, inputHash: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO groundings (signal_id, payload, input_hash)
         VALUES (?, ?, ?)`,
      )
      .run(grounding.signal_id, JSON.stringify(grounding), inputHash);
  }

  getDiversificationPlansForClient(clientId: string): DiversificationPlan[] {
    const rows = this.db
      .prepare(
        `SELECT signal_id, payload
         FROM diversification_plans
         WHERE client_id = ?
         ORDER BY generated_at DESC`,
      )
      .all(clientId) as Array<{ signal_id: string; payload: string }>;
    const seenSignals = new Set<string>();
    const plans: DiversificationPlan[] = [];
    for (const row of rows) {
      if (seenSignals.has(row.signal_id)) continue;
      seenSignals.add(row.signal_id);
      plans.push(JSON.parse(row.payload) as DiversificationPlan);
    }
    return plans;
  }

  getLatestRiskPriorities(): StoredRiskPriority[] {
    const rows = this.db
      .prepare(
        `SELECT payload
         FROM priorities
         WHERE run_id = (
           SELECT run_id FROM priorities ORDER BY run_id DESC LIMIT 1
         )
         ORDER BY rank`,
      )
      .all() as Array<{ payload: string }>;
    return rows.map(
      (row) => JSON.parse(row.payload) as StoredRiskPriority,
    );
  }

  getLatestRiskPrioritiesForRm(rmId: string): StoredRiskPriority[] {
    const rows = this.db
      .prepare(
        `SELECT p.payload
         FROM priorities p
         INNER JOIN clients c ON c.client_id = p.client_id
         WHERE c.rm_id = ?
           AND p.run_id = (
             SELECT p2.run_id
             FROM priorities p2
             INNER JOIN clients c2 ON c2.client_id = p2.client_id
             WHERE c2.rm_id = ?
             ORDER BY p2.run_id DESC
             LIMIT 1
           )
         ORDER BY p.rank`,
      )
      .all(rmId, rmId) as Array<{ payload: string }>;
    return rows.map(
      (row) => JSON.parse(row.payload) as StoredRiskPriority,
    );
  }

  saveRiskPriorities(priorities: StoredRiskPriority[]): void {
    if (priorities.length === 0) return;
    const runId = priorities[0].generated_at;
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO priorities
       (run_id, rank, client_id, payload)
       VALUES (?, ?, ?, ?)`,
    );
    const save = this.db.transaction((items: StoredRiskPriority[]) => {
      for (const priority of items) {
        insert.run(
          runId,
          priority.rank,
          priority.client_id,
          JSON.stringify(priority),
        );
      }
    });
    save(priorities);
  }

  getDiversificationPlan(
    signalId: string,
    inputHash?: string,
  ): DiversificationPlan | undefined {
    const row = inputHash
      ? (this.db
          .prepare(
            `SELECT payload FROM diversification_plans
             WHERE signal_id = ? AND input_hash = ?
             ORDER BY generated_at DESC LIMIT 1`,
          )
          .get(signalId, inputHash) as { payload: string } | undefined)
      : (this.db
          .prepare(
            `SELECT payload FROM diversification_plans
             WHERE signal_id = ? ORDER BY generated_at DESC LIMIT 1`,
          )
          .get(signalId) as { payload: string } | undefined);
    return row ? (JSON.parse(row.payload) as DiversificationPlan) : undefined;
  }

  getDiversificationPlanById(
    planId: string,
  ): { plan: DiversificationPlan; input_hash: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT payload, input_hash FROM diversification_plans
         WHERE plan_id = ?`,
      )
      .get(planId) as { payload: string; input_hash: string } | undefined;
    return row
      ? {
          plan: JSON.parse(row.payload) as DiversificationPlan,
          input_hash: row.input_hash,
        }
      : undefined;
  }

  saveDiversificationPlan(plan: DiversificationPlan, inputHash: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO diversification_plans
         (plan_id, signal_id, client_id, payload, input_hash, generated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.plan_id,
        plan.signal_id,
        plan.client_id,
        JSON.stringify(plan),
        inputHash,
        plan.generated_at,
      );
  }

  appendAuditEntry(input: AppendAuditEntryInput): AuditEntry {
    const append = this.db.transaction((entryInput: AppendAuditEntryInput) => {
      const previous = this.db
        .prepare("SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1")
        .get() as { hash: string | null } | undefined;
      const prevHash = previous?.hash || GENESIS_HASH;
      const entryWithoutHashes = {
        entry_id: randomUUID(),
        ts: new Date().toISOString(),
        ...entryInput,
      };
      const hash = calculateAuditHash(prevHash, entryWithoutHashes);
      const entry = AuditEntry.parse({
        ...entryWithoutHashes,
        prev_hash: prevHash,
        hash,
      });

      this.db
        .prepare(
          `INSERT INTO audit_log (
            entry_id, ts, rm_id, action, target_type, target_id, client_id,
            before, after, reason_code, reason_text, confidence_at_decision,
            prompt_version, model, input_hash, context_pack_hash, source_refs,
            prev_hash, hash
          ) VALUES (
            @entry_id, @ts, @rm_id, @action, @target_type, @target_id, @client_id,
            @before, @after, @reason_code, @reason_text, @confidence_at_decision,
            @prompt_version, @model, @input_hash, @context_pack_hash, @source_refs,
            @prev_hash, @hash
          )`,
        )
        .run({
          ...entry,
          before: canonicalJson(entry.before),
          after: entry.after === null ? null : canonicalJson(entry.after),
          source_refs: canonicalJson(entry.source_refs),
        });
      return entry;
    });

    return append.immediate(input);
  }

  getLatestDecision(
    targetType: DecisionTargetType,
    targetId: string,
    clientId: string,
  ): AuditEntry | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM audit_log
         WHERE target_type = ? AND target_id = ? AND client_id = ?
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(targetType, targetId, clientId) as
      | (Omit<AuditEntry, "before" | "after" | "source_refs"> & {
          before: string;
          after: string | null;
          source_refs: string;
        })
      | undefined;
    if (!row) return undefined;
    return AuditEntry.parse({
      ...row,
      before: JSON.parse(row.before),
      after: row.after === null ? null : JSON.parse(row.after),
      source_refs: JSON.parse(row.source_refs),
    });
  }
}
