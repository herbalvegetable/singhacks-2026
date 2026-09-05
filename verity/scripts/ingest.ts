import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../lib/db/client";
import type Database from "better-sqlite3";

const DATA_DIR = path.join(process.cwd(), "data");

type CountRow = { count: number };
type MissingCostRow = {
  snapshot_date: string;
  portfolio_id: string;
  client_id: string;
  instrument_id: string;
  instrument_name: string;
};
type PreRelationshipRow = {
  portfolio_id: string;
  client_id: string;
  snapshot_date: string;
  client_since: string;
};
type DataRow = Record<string, string | number | null>;

function loadCSV(filename: string): DataRow[] {
  const content = fs.readFileSync(path.join(DATA_DIR, filename), "utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
    cast_date: false,
  }) as DataRow[];
}

function loadJSON(filename: string): DataRow[] {
  const content = fs.readFileSync(path.join(DATA_DIR, filename), "utf-8");
  return JSON.parse(content) as DataRow[];
}

function createTables(db: Database.Database) {
  db.exec(`
    -- Core tables
    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      age INTEGER,
      gender TEXT,
      nationality TEXT,
      country_of_residence TEXT,
      tax_domicile TEXT,
      booking_centre TEXT,
      rm_id TEXT,
      rm_name TEXT,
      rm_desk TEXT,
      base_currency TEXT,
      wealth_band TEXT,
      total_aum_usd REAL,
      life_stage TEXT,
      source_of_wealth TEXT,
      risk_profile TEXT,
      risk_tolerance_score INTEGER,
      investment_horizon_years INTEGER,
      liquidity_needs TEXT,
      objectives TEXT,
      client_since TEXT,
      kyc_review_due TEXT,
      pep_status TEXT,
      reporting_language TEXT
    );

    CREATE TABLE IF NOT EXISTS portfolios (
      portfolio_id TEXT PRIMARY KEY,
      client_id TEXT,
      portfolio_name TEXT,
      mandate_code TEXT,
      mandate_name TEXT,
      service_model TEXT,
      base_currency TEXT,
      inception_date TEXT,
      benchmark TEXT,
      aum_usd_current REAL,
      FOREIGN KEY (client_id) REFERENCES clients(client_id)
    );

    CREATE TABLE IF NOT EXISTS holdings (
      snapshot_date TEXT,
      portfolio_id TEXT,
      client_id TEXT,
      instrument_id TEXT,
      instrument_name TEXT,
      asset_class TEXT,
      sub_asset_class TEXT,
      sector TEXT,
      region TEXT,
      instrument_ccy TEXT,
      quantity REAL,
      price_local REAL,
      market_value_local REAL,
      portfolio_ccy TEXT,
      market_value_base REAL,
      market_value_usd REAL,
      weight_pct REAL,
      avg_cost_local REAL,
      cost_basis_base REAL,
      unrealised_pnl_base REAL,
      unrealised_pnl_pct REAL,
      lending_value_base REAL,
      advance_rate_pct REAL,
      liquidity_tier TEXT,
      valuation_date TEXT,
      acquired_date TEXT,
      PRIMARY KEY (snapshot_date, portfolio_id, instrument_id)
    );

    CREATE TABLE IF NOT EXISTS instruments (
      instrument_id TEXT PRIMARY KEY,
      instrument_name TEXT,
      asset_class TEXT,
      sub_asset_class TEXT,
      sector TEXT,
      region TEXT,
      currency TEXT,
      liquidity_tier TEXT,
      underlying_reference TEXT,
      sustainability_excluded TEXT,
      concentration_limit_applies TEXT
    );

    CREATE TABLE IF NOT EXISTS mandates (
      mandate_code TEXT,
      mandate_name TEXT,
      asset_class TEXT,
      min_pct REAL,
      target_pct REAL,
      max_pct REAL,
      max_single_position_pct REAL,
      mandate_notes TEXT,
      PRIMARY KEY (mandate_code, asset_class)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      trade_date TEXT,
      settlement_date TEXT,
      portfolio_id TEXT,
      client_id TEXT,
      transaction_type TEXT,
      instrument_id TEXT,
      instrument_name TEXT,
      quantity REAL,
      price_local REAL,
      currency TEXT,
      amount REAL,
      narrative TEXT
    );

    CREATE TABLE IF NOT EXISTS credit_facilities (
      facility_id TEXT PRIMARY KEY,
      client_id TEXT,
      collateral_portfolio_id TEXT,
      facility_type TEXT,
      facility_ccy TEXT,
      credit_limit REAL,
      interest_rate_pct REAL,
      margin_call_ltv_pct REAL,
      utilisation_pct_current REAL
    );

    CREATE TABLE IF NOT EXISTS commitments (
      commitment_id TEXT PRIMARY KEY,
      client_id TEXT,
      portfolio_id TEXT,
      fund_name TEXT,
      currency TEXT,
      committed REAL,
      called_to_date REAL,
      uncalled REAL,
      expected_call_window TEXT
    );

    CREATE TABLE IF NOT EXISTS planned_cash_needs (
      need_id TEXT PRIMARY KEY,
      client_id TEXT,
      description TEXT,
      currency TEXT,
      amount REAL,
      due_from TEXT,
      due_to TEXT,
      recurrence TEXT,
      certainty TEXT
    );

    CREATE TABLE IF NOT EXISTS market_context (
      snapshot_date TEXT,
      series_id TEXT,
      series_name TEXT,
      category TEXT,
      unit TEXT,
      value REAL,
      snapshot_label TEXT,
      PRIMARY KEY (snapshot_date, series_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_date TEXT,
      event_type TEXT,
      region TEXT,
      description TEXT,
      primary_transmission TEXT,
      severity TEXT,
      transmission_tokens TEXT
    );

    CREATE TABLE IF NOT EXISTS rm_notes (
      note_id TEXT PRIMARY KEY,
      client_id TEXT,
      note_date TEXT,
      rm_id TEXT,
      rm_name TEXT,
      channel TEXT,
      note TEXT
    );

    -- Derived tables
    CREATE TABLE IF NOT EXISTS instrument_prices (
      instrument_id TEXT,
      snapshot_date TEXT,
      price REAL,
      PRIMARY KEY (instrument_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS portfolio_aum (
      portfolio_id TEXT,
      snapshot_date TEXT,
      aum_base REAL,
      PRIMARY KEY (portfolio_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS facility_snapshots (
      facility_id TEXT,
      snapshot_date TEXT,
      drawn REAL,
      collateral_market_value REAL,
      lending_value REAL,
      ltv_pct REAL,
      headroom REAL,
      PRIMARY KEY (facility_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS fx_rates (
      snapshot_date TEXT,
      ccy TEXT,
      usd_per_unit REAL,
      PRIMARY KEY (snapshot_date, ccy)
    );

    CREATE TABLE IF NOT EXISTS data_quality_flags (
      flag_id TEXT PRIMARY KEY,
      severity TEXT,
      scope_type TEXT,
      scope_id TEXT,
      code TEXT,
      description TEXT,
      source_ref TEXT
    );

    -- Pipeline output tables
    CREATE TABLE IF NOT EXISTS signals (
      signal_id TEXT PRIMARY KEY,
      client_id TEXT,
      payload TEXT
    );

    CREATE TABLE IF NOT EXISTS groundings (
      signal_id TEXT PRIMARY KEY,
      payload TEXT,
      input_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS narratives (
      client_id TEXT PRIMARY KEY,
      payload TEXT,
      input_hash TEXT
    );

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

    CREATE TABLE IF NOT EXISTS priorities (
      run_id TEXT,
      rank INTEGER,
      client_id TEXT,
      payload TEXT,
      PRIMARY KEY (run_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      entry_id TEXT PRIMARY KEY,
      ts TEXT,
      rm_id TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      client_id TEXT,
      before TEXT,
      after TEXT,
      reason_code TEXT,
      reason_text TEXT,
      confidence_at_decision INTEGER,
      prompt_version TEXT,
      model TEXT,
      input_hash TEXT,
      context_pack_hash TEXT,
      source_refs TEXT,
      prev_hash TEXT,
      hash TEXT
    );
  `);
}

function ingestData(db: Database.Database) {
  console.log("Loading source files...");

  // Load all files
  const clients = loadCSV("clients.csv");
  const portfolios = loadCSV("portfolios.csv");
  const holdings = loadCSV("holdings.csv");
  const instruments = loadCSV("instruments.csv");
  const mandates = loadCSV("mandates.csv");
  const transactions = loadCSV("transactions.csv");
  const facilities = loadCSV("credit_facilities.csv");
  const commitments = loadCSV("commitments.csv");
  const cashNeeds = loadCSV("planned_cash_needs.csv");
  const marketContext = loadCSV("market_context.csv");
  const eventLog = loadCSV("event_log.csv");
  const rmNotes = loadJSON("rm_notes.json");

  console.log(`Loaded ${clients.length} clients`);
  console.log(`Loaded ${holdings.length} holdings`);
  console.log(`Loaded ${eventLog.length} events`);

  // Insert clients
  const clientStmt = db.prepare(`
    INSERT OR REPLACE INTO clients VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const c of clients) {
    clientStmt.run(
      c.client_id, c.client_name, c.age, c.gender, c.nationality,
      c.country_of_residence, c.tax_domicile, c.booking_centre,
      c.rm_id, c.rm_name, c.rm_desk, c.base_currency, c.wealth_band,
      c.total_aum_usd, c.life_stage, c.source_of_wealth, c.risk_profile,
      c.risk_tolerance_score, c.investment_horizon_years, c.liquidity_needs,
      c.objectives, c.client_since, c.kyc_review_due, c.pep_status,
      c.reporting_language
    );
  }

  // Extract aum columns for portfolios
  const portfolioStmt = db.prepare(`
    INSERT OR REPLACE INTO portfolios VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const aumStmt = db.prepare(`
    INSERT OR REPLACE INTO portfolio_aum VALUES (?, ?, ?)
  `);

  const snapshots = ["2025-12-31", "2026-02-27", "2026-03-31", "2026-06-30", "2026-08-26"];

  for (const p of portfolios) {
    portfolioStmt.run(
      p.portfolio_id, p.client_id, p.portfolio_name, p.mandate_code,
      p.mandate_name, p.service_model, p.base_currency, p.inception_date,
      p.benchmark, p.aum_usd_current
    );

    // Unpivot AUM columns
    for (const snap of snapshots) {
      const key = `aum_${snap}`;
      if (p[key] != null) {
        aumStmt.run(p.portfolio_id, snap, p[key]);
      }
    }
  }

  // Insert holdings
  const holdingsStmt = db.prepare(`
    INSERT OR REPLACE INTO holdings VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const h of holdings) {
    holdingsStmt.run(
      h.snapshot_date, h.portfolio_id, h.client_id, h.instrument_id,
      h.instrument_name, h.asset_class, h.sub_asset_class, h.sector, h.region,
      h.instrument_ccy, h.quantity, h.price_local, h.market_value_local,
      h.portfolio_ccy, h.market_value_base, h.market_value_usd, h.weight_pct,
      h.avg_cost_local, h.cost_basis_base, h.unrealised_pnl_base,
      h.unrealised_pnl_pct, h.lending_value_base, h.advance_rate_pct,
      h.liquidity_tier, h.valuation_date, h.acquired_date
    );
  }

  // Insert instruments and unpivot prices
  const instStmt = db.prepare(`
    INSERT OR REPLACE INTO instruments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const priceStmt = db.prepare(`
    INSERT OR REPLACE INTO instrument_prices VALUES (?, ?, ?)
  `);

  for (const i of instruments) {
    instStmt.run(
      i.instrument_id, i.instrument_name, i.asset_class, i.sub_asset_class,
      i.sector, i.region, i.currency, i.liquidity_tier, i.underlying_reference,
      i.sustainability_excluded, i.concentration_limit_applies
    );

    // Unpivot price columns
    for (const snap of snapshots) {
      const key = `price_${snap}`;
      if (i[key] != null) {
        priceStmt.run(i.instrument_id, snap, i[key]);
      }
    }
  }

  // Insert mandates
  const mandateStmt = db.prepare(`
    INSERT OR REPLACE INTO mandates VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of mandates) {
    mandateStmt.run(
      m.mandate_code, m.mandate_name, m.asset_class, m.min_pct, m.target_pct,
      m.max_pct, m.max_single_position_pct, m.mandate_notes
    );
  }

  // Insert transactions
  const txnStmt = db.prepare(`
    INSERT OR REPLACE INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of transactions) {
    txnStmt.run(
      t.transaction_id, t.trade_date, t.settlement_date, t.portfolio_id,
      t.client_id, t.transaction_type, t.instrument_id, t.instrument_name,
      t.quantity, t.price_local, t.currency, t.amount, t.narrative
    );
  }

  // Insert facilities and unpivot snapshots
  const facilityStmt = db.prepare(`
    INSERT OR REPLACE INTO credit_facilities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const facilitySnapStmt = db.prepare(`
    INSERT OR REPLACE INTO facility_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const f of facilities) {
    facilityStmt.run(
      f.facility_id, f.client_id, f.collateral_portfolio_id, f.facility_type,
      f.facility_ccy, f.credit_limit, f.interest_rate_pct, f.margin_call_ltv_pct,
      f.utilisation_pct_current
    );

    // Unpivot facility snapshots
    for (const snap of snapshots) {
      facilitySnapStmt.run(
        f.facility_id, snap,
        f[`drawn_${snap}`],
        f[`collateral_market_value_${snap}`],
        f[`lending_value_${snap}`],
        f[`ltv_pct_${snap}`],
        f[`headroom_${snap}`]
      );
    }
  }

  // Insert commitments
  const commitmentStmt = db.prepare(`
    INSERT OR REPLACE INTO commitments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of commitments) {
    commitmentStmt.run(
      c.commitment_id, c.client_id, c.portfolio_id, c.fund_name, c.currency,
      c.committed, c.called_to_date, c.uncalled, c.expected_call_window
    );
  }

  // Insert cash needs
  const needStmt = db.prepare(`
    INSERT OR REPLACE INTO planned_cash_needs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const n of cashNeeds) {
    needStmt.run(
      n.need_id, n.client_id, n.description, n.currency, n.amount,
      n.due_from, n.due_to, n.recurrence, n.certainty
    );
  }

  // Insert market context
  const marketStmt = db.prepare(`
    INSERT OR REPLACE INTO market_context VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of marketContext) {
    marketStmt.run(
      m.snapshot_date, m.series_id, m.series_name, m.category, m.unit,
      m.value, m.snapshot_label
    );
  }

  // Process FX rates - normalize to usd_per_unit
  const fxStmt = db.prepare(`
    INSERT OR REPLACE INTO fx_rates VALUES (?, ?, ?)
  `);

  const fxPairs = marketContext.filter(m => m.category === "FX");
  for (const fx of fxPairs) {
    const pair = String(fx.series_id ?? "");
    const value = Number(fx.value);
    if (!pair || !Number.isFinite(value) || value === 0) continue;
    let ccy = "";
    let usdPerUnit = 0;

    // Parse pair and normalize
    if (pair === "EURUSD") {
      ccy = "EUR";
      usdPerUnit = value; // USD per EUR
    } else if (pair.startsWith("USD")) {
      // USDSGD, USDHKD, etc - inverted
      ccy = pair.substring(3);
      usdPerUnit = 1 / value;
    } else if (pair === "GBPUSD") {
      ccy = "GBP";
      usdPerUnit = value;
    }

    if (ccy) {
      fxStmt.run(fx.snapshot_date, ccy, usdPerUnit);
    }
  }

  // Add USD itself
  for (const snap of snapshots) {
    fxStmt.run(snap, "USD", 1.0);
  }

  // Process events - synthesize event_id and tokenize
  const eventStmt = db.prepare(`
    INSERT OR REPLACE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Sort events by date then description for deterministic IDs
  const sortedEvents = eventLog.sort((a, b) => {
    const aDate = String(a.event_date ?? "");
    const bDate = String(b.event_date ?? "");
    if (aDate !== bDate) {
      return aDate < bDate ? -1 : 1;
    }
    return String(a.description ?? "") < String(b.description ?? "") ? -1 : 1;
  });

  for (let i = 0; i < sortedEvents.length; i++) {
    const e = sortedEvents[i];
    const eventId = `EVT-${String(i + 1).padStart(3, "0")}`;

    // Tokenize transmission
    const tokens = String(e.primary_transmission ?? "")
      .toLowerCase()
      .split(/[,;]/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    eventStmt.run(
      eventId, e.event_date, e.event_type, e.region, e.description,
      e.primary_transmission, e.severity, JSON.stringify(tokens)
    );
  }

  // Insert RM notes
  const noteStmt = db.prepare(`
    INSERT OR REPLACE INTO rm_notes VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const n of rmNotes) {
    noteStmt.run(
      n.note_id, n.client_id, n.note_date, n.rm_id, n.rm_name, n.channel, n.note
    );
  }

  console.log("✓ All source data ingested");
}

function detectDataQualityFlags(db: Database.Database) {
  console.log("Detecting data quality flags...");

  const flagStmt = db.prepare(`
    INSERT OR REPLACE INTO data_quality_flags VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Missing cost basis
  const missingCost = db.prepare(`
    SELECT DISTINCT snapshot_date, portfolio_id, client_id, instrument_id, instrument_name
    FROM holdings
    WHERE avg_cost_local IS NULL AND cost_basis_base IS NULL
    AND snapshot_date = '2026-08-26'
  `).all() as MissingCostRow[];

  for (const row of missingCost) {
    const id = `FLAG-COST-${row.portfolio_id}-${row.instrument_id}`;
    flagStmt.run(
      id, "error", "position", `${row.portfolio_id}:${row.instrument_id}`,
      "MISSING_COST_BASIS",
      `Cost basis not provided for ${row.instrument_name}. Tax analysis unavailable.`,
      `holdings.csv:${row.snapshot_date}:${row.portfolio_id}:${row.instrument_id}`
    );
  }

  // Pre-relationship snapshots (PF-0005)
  const preRelSnaps = db.prepare(`
    SELECT DISTINCT h.portfolio_id, h.client_id, h.snapshot_date, c.client_since
    FROM holdings h
    JOIN clients c ON h.client_id = c.client_id
    WHERE h.snapshot_date < c.client_since
  `).all() as PreRelationshipRow[];

  for (const row of preRelSnaps) {
    const id = `FLAG-PREREL-${row.portfolio_id}`;
    flagStmt.run(
      id, "warning", "portfolio", row.portfolio_id,
      "PRE_RELATIONSHIP_SNAPSHOT",
      `Holdings exist at ${row.snapshot_date}, before client_since ${row.client_since}. Baseline shifted.`,
      `holdings.csv:${row.portfolio_id}:${row.snapshot_date}`
    );
  }

  // Lagged private marks
  const laggedMarks = ["SYN-AL-0301", "SYN-AL-0305", "SYN-AL-0308"];
  for (const inst of laggedMarks) {
    const id = `FLAG-LAG-${inst}`;
    flagStmt.run(
      id, "warning", "position", inst,
      "LAGGED_PRIVATE_MARK",
      "Private markets valuation lags by one quarter. Current mark may not reflect recent performance.",
      `instruments.csv:${inst}`
    );
  }

  console.log(`✓ Detected ${missingCost.length + preRelSnaps.length + laggedMarks.length} data quality flags`);
}

function main() {
  console.log("=== Verity Data Ingestion ===\n");

  const db = getDb();

  try {
    console.log("Creating tables...");
    createTables(db);

    console.log("Ingesting data...");
    ingestData(db);

    console.log("Detecting data quality issues...");
    detectDataQualityFlags(db);

    // Print summary
    const counts = {
      clients: db.prepare("SELECT COUNT(*) as count FROM clients").get() as CountRow,
      holdings: db.prepare("SELECT COUNT(*) as count FROM holdings").get() as CountRow,
      events: db.prepare("SELECT COUNT(*) as count FROM events").get() as CountRow,
      flags: db.prepare("SELECT COUNT(*) as count FROM data_quality_flags").get() as CountRow,
    };

    console.log("\n=== Ingestion Summary ===");
    console.log(`Clients:     ${counts.clients.count}`);
    console.log(`Holdings:    ${counts.holdings.count}`);
    console.log(`Events:      ${counts.events.count}`);
    console.log(`DQ Flags:    ${counts.flags.count}`);
    console.log("\n✓ Ingestion complete");
  } finally {
    closeDb();
  }
}

main();
