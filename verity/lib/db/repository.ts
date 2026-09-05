import { createHash, randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { getDb, withTransaction, type Queryable, type TransactionCapable } from "./client";
import { Grounding, type Signal } from "../contracts/signal";
import type { DiversificationPlan } from "../contracts/diversification";
import type { StoredRiskPriority } from "../contracts/priority";
import {
  AuditEntry,
  type AppendAuditEntryInput,
  type DecisionTargetType,
} from "../contracts/decision";

const GENESIS_HASH = "0".repeat(64);
const AUDIT_CHAIN_LOCK_KEY = 1_447_113_881;

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

export interface Client extends QueryResultRow {
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
  client_since: string;
}

export interface Holding extends QueryResultRow {
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

export interface Instrument extends QueryResultRow {
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

export interface Transaction extends QueryResultRow {
  transaction_id: string;
  trade_date: string;
  portfolio_id: string;
  transaction_type: string;
  instrument_id: string | null;
  quantity: number | null;
  amount: number;
  narrative: string;
}

export interface Mandate extends QueryResultRow {
  mandate_code: string;
  mandate_name: string;
  asset_class: string;
  min_pct: number;
  target_pct: number;
  max_pct: number;
  max_single_position_pct: number;
  mandate_notes: string;
}

export interface Portfolio extends QueryResultRow {
  portfolio_id: string;
  client_id: string;
  portfolio_name: string;
  mandate_code: string;
  mandate_name: string;
  service_model: string;
}

export interface FacilitySnapshot extends QueryResultRow {
  facility_id: string;
  snapshot_date: string;
  drawn: number;
  collateral_market_value: number;
  lending_value: number;
  ltv_pct: number;
  headroom: number;
}

export interface CreditFacility extends QueryResultRow {
  facility_id: string;
  client_id: string;
  collateral_portfolio_id: string;
  margin_call_ltv_pct: number;
  facility_ccy: string;
}

export interface RmNote extends QueryResultRow {
  note_id: string;
  client_id: string;
  note_date: string;
  channel: string;
  note: string;
}

export interface CashNeed extends QueryResultRow {
  need_id: string;
  client_id: string;
  description: string;
  currency: string;
  amount: number;
  due_from: string;
  due_to: string;
  certainty: string;
}

export interface Commitment extends QueryResultRow {
  commitment_id: string;
  client_id: string;
  portfolio_id: string;
  fund_name: string;
  currency: string;
  uncalled: number;
  expected_call_window: string;
}

export interface MarketContext extends QueryResultRow {
  snapshot_date: string;
  series_id: string;
  series_name: string;
  category: string;
  unit: string;
  value: number;
  snapshot_label: string;
}

export interface InstrumentPrice extends QueryResultRow {
  instrument_id: string;
  snapshot_date: string;
  price: number;
}

export interface MarketEvent extends QueryResultRow {
  event_id: string;
  event_date: string;
  event_type: string;
  region: string;
  description: string;
  primary_transmission: string;
  severity: string;
  transmission_tokens: string;
}

export interface MorningBriefClient {
  client_id: string;
  client_name: string;
  total_aum_usd: number;
  signals: Signal[];
}

export interface PortfolioAllocation extends QueryResultRow {
  portfolio_id: string;
  asset_class: string;
  value_usd: number;
}

export interface DossierFlag extends QueryResultRow {
  flag_id: string;
  severity: "error" | "warning";
  scope_type: string;
  scope_id: string;
  code: string;
  description: string;
  source_ref: string;
}

export interface NarrativeRow {
  payload: Record<string, unknown>;
  input_hash: Record<string, string>;
}

type JsonRow = QueryResultRow & { payload: string };
type AuditDatabaseRow = QueryResultRow &
  Omit<AuditEntry, "before" | "after" | "source_refs"> & {
    before: string;
    after: string | null;
    source_refs: string;
  };

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export class Repository {
  constructor(
    private readonly db: TransactionCapable = getDb(),
    private readonly options: { useAdvisoryLock?: boolean } = {},
  ) {}

  async getClient(clientId: string): Promise<Client | undefined> {
    const result = await this.db.query<Client>(
      "SELECT * FROM clients WHERE client_id = $1",
      [clientId],
    );
    return result.rows[0];
  }

  async getAllClients(): Promise<Client[]> {
    return (await this.db.query<Client>("SELECT * FROM clients")).rows;
  }

  async getClientsForRm(rmId: string): Promise<Client[]> {
    return (
      await this.db.query<Client>(
        "SELECT * FROM clients WHERE rm_id = $1 ORDER BY client_name",
        [rmId],
      )
    ).rows;
  }

  async clientBelongsToRm(clientId: string, rmId: string): Promise<boolean> {
    const result = await this.db.query(
      "SELECT 1 FROM clients WHERE client_id = $1 AND rm_id = $2",
      [clientId, rmId],
    );
    return result.rowCount !== 0;
  }

  async signalBelongsToRm(signalId: string, rmId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1
       FROM signals s
       INNER JOIN clients c ON c.client_id = s.client_id
       WHERE s.signal_id = $1 AND c.rm_id = $2`,
      [signalId, rmId],
    );
    return result.rowCount !== 0;
  }

  async getHoldingsForClient(
    clientId: string,
    snapshotDate: string,
  ): Promise<Holding[]> {
    return (
      await this.db.query<Holding>(
        `SELECT * FROM holdings
         WHERE client_id = $1 AND snapshot_date = $2
         ORDER BY market_value_usd DESC`,
        [clientId, snapshotDate],
      )
    ).rows;
  }

  async getHoldingsForPortfolio(
    portfolioId: string,
    snapshotDate: string,
  ): Promise<Holding[]> {
    return (
      await this.db.query<Holding>(
        `SELECT * FROM holdings
         WHERE portfolio_id = $1 AND snapshot_date = $2
         ORDER BY market_value_usd DESC`,
        [portfolioId, snapshotDate],
      )
    ).rows;
  }

  async getHoldingHistory(
    portfolioId: string,
    instrumentId: string,
  ): Promise<Holding[]> {
    return (
      await this.db.query<Holding>(
        `SELECT * FROM holdings
         WHERE portfolio_id = $1 AND instrument_id = $2
         ORDER BY snapshot_date`,
        [portfolioId, instrumentId],
      )
    ).rows;
  }

  async getInstrument(instrumentId: string): Promise<Instrument | undefined> {
    return (
      await this.db.query<Instrument>(
        "SELECT * FROM instruments WHERE instrument_id = $1",
        [instrumentId],
      )
    ).rows[0];
  }

  async getInstruments(instrumentIds: string[]): Promise<Instrument[]> {
    if (instrumentIds.length === 0) return [];
    return (
      await this.db.query<Instrument>(
        `SELECT * FROM instruments WHERE instrument_id IN (${placeholders(instrumentIds.length)})`,
        instrumentIds,
      )
    ).rows;
  }

  async getTransactionsInWindow(
    portfolioId: string,
    from: string,
    to: string,
  ): Promise<Transaction[]> {
    return (
      await this.db.query<Transaction>(
        `SELECT * FROM transactions
         WHERE portfolio_id = $1 AND trade_date >= $2 AND trade_date <= $3
         ORDER BY trade_date`,
        [portfolioId, from, to],
      )
    ).rows;
  }

  async getMandatesForCode(mandateCode: string): Promise<Mandate[]> {
    return (
      await this.db.query<Mandate>(
        "SELECT * FROM mandates WHERE mandate_code = $1",
        [mandateCode],
      )
    ).rows;
  }

  async getPortfoliosForClient(clientId: string): Promise<Portfolio[]> {
    return (
      await this.db.query<Portfolio>(
        "SELECT * FROM portfolios WHERE client_id = $1",
        [clientId],
      )
    ).rows;
  }

  async getFacilitySnapshots(facilityId: string): Promise<FacilitySnapshot[]> {
    return (
      await this.db.query<FacilitySnapshot>(
        `SELECT * FROM facility_snapshots
         WHERE facility_id = $1 ORDER BY snapshot_date`,
        [facilityId],
      )
    ).rows;
  }

  async getFacilitiesForClient(clientId: string): Promise<CreditFacility[]> {
    return (
      await this.db.query<CreditFacility>(
        "SELECT * FROM credit_facilities WHERE client_id = $1",
        [clientId],
      )
    ).rows;
  }

  async getSignalsForClient(clientId: string): Promise<Signal[]> {
    const rows = (
      await this.db.query<JsonRow>(
        "SELECT payload FROM signals WHERE client_id = $1",
        [clientId],
      )
    ).rows;
    return rows.map((row) => JSON.parse(row.payload) as Signal);
  }

  async getSignal(signalId: string): Promise<Signal | undefined> {
    const row = (
      await this.db.query<JsonRow>(
        "SELECT payload FROM signals WHERE signal_id = $1",
        [signalId],
      )
    ).rows[0];
    return row ? (JSON.parse(row.payload) as Signal) : undefined;
  }

  async getNarrativesForClient(
    clientId: string,
  ): Promise<Record<string, unknown>> {
    return (await this.getNarrativeRow(clientId))?.payload ?? {};
  }

  async getNarrativeArtifact(
    clientId: string,
    signalId: string,
  ): Promise<{ narrative: unknown; input_hash: string } | undefined> {
    const row = await this.getNarrativeRow(clientId);
    if (!row || !(signalId in row.payload)) return undefined;
    return {
      narrative: row.payload[signalId],
      input_hash: row.input_hash[signalId] ?? "",
    };
  }

  async getRmNotesForClient(clientId: string): Promise<RmNote[]> {
    return (
      await this.db.query<RmNote>(
        `SELECT note_id, client_id, note_date, channel, note
         FROM rm_notes WHERE client_id = $1 ORDER BY note_date DESC`,
        [clientId],
      )
    ).rows;
  }

  async getTransactionsForClient(
    clientId: string,
    limit = 50,
  ): Promise<Transaction[]> {
    return (
      await this.db.query<Transaction>(
        `SELECT * FROM transactions WHERE client_id = $1
         ORDER BY trade_date DESC LIMIT $2`,
        [clientId, limit],
      )
    ).rows;
  }

  async getCashNeedsForClient(clientId: string): Promise<CashNeed[]> {
    return (
      await this.db.query<CashNeed>(
        `SELECT * FROM planned_cash_needs WHERE client_id = $1
         ORDER BY due_from`,
        [clientId],
      )
    ).rows;
  }

  async getCommitmentsForClient(clientId: string): Promise<Commitment[]> {
    return (
      await this.db.query<Commitment>(
        `SELECT * FROM commitments WHERE client_id = $1
         ORDER BY expected_call_window`,
        [clientId],
      )
    ).rows;
  }

  async getClientDataQualityFlags(
    clientId: string,
  ): Promise<Record<string, unknown>[]> {
    return (
      await this.db.query<QueryResultRow>(
        `SELECT DISTINCT dq.*
         FROM data_quality_flags dq
         LEFT JOIN portfolios p
           ON dq.scope_id = p.portfolio_id
           OR dq.scope_id LIKE p.portfolio_id || ':%'
         LEFT JOIN holdings h
           ON dq.scope_id = h.instrument_id
           OR dq.scope_id LIKE '%:' || h.instrument_id
         WHERE dq.scope_id = $1
            OR p.client_id = $1
            OR h.client_id = $1`,
        [clientId],
      )
    ).rows;
  }

  async getDataQualityFlags(
    scopeId: string,
  ): Promise<Record<string, unknown>[]> {
    return (
      await this.db.query<QueryResultRow>(
        "SELECT * FROM data_quality_flags WHERE scope_id LIKE $1",
        [`%${scopeId}%`],
      )
    ).rows;
  }

  async getSnapshotDates(): Promise<string[]> {
    const result = await this.db.query<QueryResultRow & { snapshot_date: string }>(
      "SELECT DISTINCT snapshot_date FROM holdings ORDER BY snapshot_date",
    );
    return result.rows.map((row) => row.snapshot_date);
  }

  async getMarketContext(snapshotDates?: string[]): Promise<MarketContext[]> {
    if (!snapshotDates || snapshotDates.length === 0) {
      return (
        await this.db.query<MarketContext>(
          "SELECT * FROM market_context ORDER BY snapshot_date, series_id",
        )
      ).rows;
    }
    return (
      await this.db.query<MarketContext>(
        `SELECT * FROM market_context
         WHERE snapshot_date IN (${placeholders(snapshotDates.length)})
         ORDER BY snapshot_date, series_id`,
        snapshotDates,
      )
    ).rows;
  }

  async getInstrumentPrices(
    instrumentIds: string[],
  ): Promise<InstrumentPrice[]> {
    if (instrumentIds.length === 0) return [];
    return (
      await this.db.query<InstrumentPrice>(
        `SELECT * FROM instrument_prices
         WHERE instrument_id IN (${placeholders(instrumentIds.length)})
         ORDER BY instrument_id, snapshot_date`,
        instrumentIds,
      )
    ).rows;
  }

  async getEvents(): Promise<MarketEvent[]> {
    return (
      await this.db.query<MarketEvent>("SELECT * FROM events ORDER BY event_date")
    ).rows;
  }

  async getGrounding(
    signalId: string,
    inputHash?: string,
  ): Promise<Grounding | undefined> {
    const values = inputHash ? [signalId, inputHash] : [signalId];
    const sql = inputHash
      ? "SELECT payload FROM groundings WHERE signal_id = $1 AND input_hash = $2"
      : "SELECT payload FROM groundings WHERE signal_id = $1";
    const row = (await this.db.query<JsonRow>(sql, values)).rows[0];
    return row ? Grounding.parse(JSON.parse(row.payload)) : undefined;
  }

  async getGroundingsForClient(clientId: string): Promise<Grounding[]> {
    const rows = (
      await this.db.query<JsonRow>(
        `SELECT g.payload
         FROM groundings g
         INNER JOIN signals s ON s.signal_id = g.signal_id
         WHERE s.client_id = $1`,
        [clientId],
      )
    ).rows;
    return rows.map((row) => Grounding.parse(JSON.parse(row.payload)));
  }

  async saveGrounding(grounding: Grounding, inputHash: string): Promise<void> {
    await this.db.query(
      `INSERT INTO groundings (signal_id, payload, input_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (signal_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         input_hash = EXCLUDED.input_hash`,
      [grounding.signal_id, JSON.stringify(grounding), inputHash],
    );
  }

  async getDiversificationPlansForClient(
    clientId: string,
  ): Promise<DiversificationPlan[]> {
    const rows = (
      await this.db.query<QueryResultRow & { signal_id: string; payload: string }>(
        `SELECT signal_id, payload
         FROM diversification_plans
         WHERE client_id = $1
         ORDER BY generated_at DESC`,
        [clientId],
      )
    ).rows;
    const seenSignals = new Set<string>();
    const plans: DiversificationPlan[] = [];
    for (const row of rows) {
      if (seenSignals.has(row.signal_id)) continue;
      seenSignals.add(row.signal_id);
      plans.push(JSON.parse(row.payload) as DiversificationPlan);
    }
    return plans;
  }

  async getLatestRiskPriorities(): Promise<StoredRiskPriority[]> {
    const rows = (
      await this.db.query<JsonRow>(
        `SELECT payload
         FROM priorities
         WHERE run_id = (
           SELECT run_id FROM priorities ORDER BY run_id DESC LIMIT 1
         )
         ORDER BY rank`,
      )
    ).rows;
    return rows.map((row) => JSON.parse(row.payload) as StoredRiskPriority);
  }

  async getLatestRiskPrioritiesForRm(
    rmId: string,
  ): Promise<StoredRiskPriority[]> {
    const rows = (
      await this.db.query<JsonRow>(
        `SELECT p.payload
         FROM priorities p
         INNER JOIN clients c ON c.client_id = p.client_id
         WHERE c.rm_id = $1
           AND p.run_id = (
             SELECT p2.run_id
             FROM priorities p2
             INNER JOIN clients c2 ON c2.client_id = p2.client_id
             WHERE c2.rm_id = $1
             ORDER BY p2.run_id DESC
             LIMIT 1
           )
         ORDER BY p.rank`,
        [rmId],
      )
    ).rows;
    return rows.map((row) => JSON.parse(row.payload) as StoredRiskPriority);
  }

  async saveRiskPriorities(
    priorities: StoredRiskPriority[],
  ): Promise<void> {
    if (priorities.length === 0) return;
    const runId = priorities[0].generated_at;
    await withTransaction(this.db, async (client) => {
      for (const priority of priorities) {
        await client.query(
          `INSERT INTO priorities (run_id, rank, client_id, payload)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (run_id, client_id) DO UPDATE SET
             rank = EXCLUDED.rank,
             payload = EXCLUDED.payload`,
          [runId, priority.rank, priority.client_id, JSON.stringify(priority)],
        );
      }
    });
  }

  async getDiversificationPlan(
    signalId: string,
    inputHash?: string,
  ): Promise<DiversificationPlan | undefined> {
    const values = inputHash ? [signalId, inputHash] : [signalId];
    const sql = inputHash
      ? `SELECT payload FROM diversification_plans
         WHERE signal_id = $1 AND input_hash = $2
         ORDER BY generated_at DESC LIMIT 1`
      : `SELECT payload FROM diversification_plans
         WHERE signal_id = $1 ORDER BY generated_at DESC LIMIT 1`;
    const row = (await this.db.query<JsonRow>(sql, values)).rows[0];
    return row ? (JSON.parse(row.payload) as DiversificationPlan) : undefined;
  }

  async getDiversificationPlanById(
    planId: string,
  ): Promise<{ plan: DiversificationPlan; input_hash: string } | undefined> {
    const row = (
      await this.db.query<QueryResultRow & { payload: string; input_hash: string }>(
        `SELECT payload, input_hash FROM diversification_plans
         WHERE plan_id = $1`,
        [planId],
      )
    ).rows[0];
    return row
      ? {
          plan: JSON.parse(row.payload) as DiversificationPlan,
          input_hash: row.input_hash,
        }
      : undefined;
  }

  async saveDiversificationPlan(
    plan: DiversificationPlan,
    inputHash: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO diversification_plans
       (plan_id, signal_id, client_id, payload, input_hash, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (plan_id) DO UPDATE SET
         signal_id = EXCLUDED.signal_id,
         client_id = EXCLUDED.client_id,
         payload = EXCLUDED.payload,
         input_hash = EXCLUDED.input_hash,
         generated_at = EXCLUDED.generated_at`,
      [
        plan.plan_id,
        plan.signal_id,
        plan.client_id,
        JSON.stringify(plan),
        inputHash,
        plan.generated_at,
      ],
    );
  }

  async appendAuditEntry(input: AppendAuditEntryInput): Promise<AuditEntry> {
    return withTransaction(this.db, async (client) => {
      if (this.options.useAdvisoryLock !== false) {
        await client.query("SELECT pg_advisory_xact_lock($1)", [
          AUDIT_CHAIN_LOCK_KEY,
        ]);
      }
      const previous = (
        await client.query<QueryResultRow & { hash: string | null }>(
          "SELECT hash FROM audit_log ORDER BY chain_seq DESC LIMIT 1",
        )
      ).rows[0];
      const prevHash = previous?.hash || GENESIS_HASH;
      const entryWithoutHashes = {
        entry_id: randomUUID(),
        ts: new Date().toISOString(),
        ...input,
      };
      const hash = calculateAuditHash(prevHash, entryWithoutHashes);
      const entry = AuditEntry.parse({
        ...entryWithoutHashes,
        prev_hash: prevHash,
        hash,
      });

      await client.query(
        `INSERT INTO audit_log (
          entry_id, ts, rm_id, action, target_type, target_id, client_id,
          before, after, reason_code, reason_text, confidence_at_decision,
          prompt_version, model, input_hash, context_pack_hash, source_refs,
          prev_hash, hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19
        )`,
        [
          entry.entry_id,
          entry.ts,
          entry.rm_id,
          entry.action,
          entry.target_type,
          entry.target_id,
          entry.client_id,
          canonicalJson(entry.before),
          entry.after === null ? null : canonicalJson(entry.after),
          entry.reason_code,
          entry.reason_text,
          entry.confidence_at_decision,
          entry.prompt_version,
          entry.model,
          entry.input_hash,
          entry.context_pack_hash,
          canonicalJson(entry.source_refs),
          entry.prev_hash,
          entry.hash,
        ],
      );
      return entry;
    });
  }

  async getLatestDecision(
    targetType: DecisionTargetType,
    targetId: string,
    clientId: string,
  ): Promise<AuditEntry | undefined> {
    const row = (
      await this.db.query<AuditDatabaseRow>(
        `SELECT * FROM audit_log
         WHERE target_type = $1 AND target_id = $2 AND client_id = $3
         ORDER BY chain_seq DESC LIMIT 1`,
        [targetType, targetId, clientId],
      )
    ).rows[0];
    if (!row) return undefined;
    return AuditEntry.parse({
      ...row,
      before: JSON.parse(row.before),
      after: row.after === null ? null : JSON.parse(row.after),
      source_refs: JSON.parse(row.source_refs),
    });
  }

  async getMorningBriefClients(rmId: string): Promise<MorningBriefClient[]> {
    const rows = (
      await this.db.query<
        QueryResultRow & {
          client_id: string;
          client_name: string;
          total_aum_usd: number;
          payload: string;
        }
      >(
        `SELECT c.client_id, c.client_name, c.total_aum_usd, s.payload
         FROM clients c
         INNER JOIN signals s ON s.client_id = c.client_id
         WHERE c.rm_id = $1
         ORDER BY c.client_name, s.signal_id`,
        [rmId],
      )
    ).rows;
    const clients = new Map<string, MorningBriefClient>();
    for (const row of rows) {
      const current = clients.get(row.client_id) ?? {
        client_id: row.client_id,
        client_name: row.client_name,
        total_aum_usd: row.total_aum_usd,
        signals: [],
      };
      current.signals.push(JSON.parse(row.payload) as Signal);
      clients.set(row.client_id, current);
    }
    return [...clients.values()].sort(
      (left, right) =>
        right.signals.length - left.signals.length ||
        left.client_name.localeCompare(right.client_name),
    );
  }

  async getClientForRm(
    clientId: string,
    rmId: string,
  ): Promise<Client | undefined> {
    return (
      await this.db.query<Client>(
        "SELECT * FROM clients WHERE client_id = $1 AND rm_id = $2",
        [clientId, rmId],
      )
    ).rows[0];
  }

  async getLatestHoldingsForClient(clientId: string): Promise<Holding[]> {
    return (
      await this.db.query<Holding>(
        `SELECT * FROM holdings
         WHERE client_id = $1
           AND snapshot_date = (
             SELECT MAX(snapshot_date) FROM holdings WHERE client_id = $1
           )
         ORDER BY market_value_usd DESC`,
        [clientId],
      )
    ).rows;
  }

  async getPortfolioAllocations(
    clientId: string,
  ): Promise<PortfolioAllocation[]> {
    return (
      await this.db.query<PortfolioAllocation>(
        `SELECT portfolio_id, asset_class,
                SUM(market_value_usd) AS value_usd
         FROM holdings
         WHERE client_id = $1
           AND snapshot_date = (
             SELECT MAX(snapshot_date) FROM holdings WHERE client_id = $1
           )
         GROUP BY portfolio_id, asset_class
         ORDER BY portfolio_id, value_usd DESC`,
        [clientId],
      )
    ).rows;
  }

  async getDossierFlags(clientId: string): Promise<DossierFlag[]> {
    return (
      await this.db.query<DossierFlag>(
        `SELECT DISTINCT dq.*
         FROM data_quality_flags dq
         LEFT JOIN portfolios p
           ON dq.scope_id = p.portfolio_id
           OR dq.scope_id LIKE p.portfolio_id || ':%'
         LEFT JOIN holdings h
           ON dq.scope_id = h.instrument_id
           OR dq.scope_id LIKE '%:' || h.instrument_id
         WHERE dq.scope_id = $1
            OR p.client_id = $1
            OR h.client_id = $1`,
        [clientId],
      )
    ).rows;
  }

  async getNarrativeRow(clientId: string): Promise<NarrativeRow | undefined> {
    const row = (
      await this.db.query<
        QueryResultRow & { payload: string; input_hash: string | null }
      >(
        "SELECT payload, input_hash FROM narratives WHERE client_id = $1",
        [clientId],
      )
    ).rows[0];
    if (!row) return undefined;
    return {
      payload: parseObject(row.payload),
      input_hash: parseObject(row.input_hash) as Record<string, string>,
    };
  }

  async saveNarrativeRow(
    clientId: string,
    payload: Record<string, unknown>,
    inputHash: Record<string, string>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO narratives (client_id, payload, input_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id) DO UPDATE SET
         payload = (
           COALESCE(NULLIF(narratives.payload, ''), '{}')::jsonb
           || EXCLUDED.payload::jsonb
         )::text,
         input_hash = (
           COALESCE(NULLIF(narratives.input_hash, ''), '{}')::jsonb
           || EXCLUDED.input_hash::jsonb
         )::text`,
      [clientId, JSON.stringify(payload), JSON.stringify(inputHash)],
    );
  }

  async replaceSignals(signals: Signal[]): Promise<void> {
    await withTransaction(this.db, async (client: Queryable) => {
      await client.query("DELETE FROM signals");
      for (const signal of signals) {
        await client.query(
          `INSERT INTO signals (signal_id, client_id, payload)
           VALUES ($1, $2, $3)`,
          [signal.signal_id, signal.client_id, JSON.stringify(signal)],
        );
      }
    });
  }
}
