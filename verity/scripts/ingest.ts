import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import {
  createAdminDb,
  withTransaction,
  type Queryable,
} from "../lib/db/client";

const DATA_DIR = path.join(process.cwd(), "data");

type CountRow = { count: string };
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

loadEnvConfig(process.cwd());

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

async function clearSeededData(db: Queryable): Promise<void> {
  const tables = [
    "groundings",
    "diversification_plans",
    "priorities",
    "narratives",
    "signals",
    "data_quality_flags",
    "rm_notes",
    "planned_cash_needs",
    "commitments",
    "facility_snapshots",
    "credit_facilities",
    "transactions",
    "instrument_prices",
    "portfolio_aum",
    "holdings",
    "mandates",
    "instruments",
    "market_context",
    "events",
    "portfolios",
    "clients",
  ];
  for (const table of tables) {
    await db.query(`DELETE FROM ${table}`);
  }
}

async function upsertRows(
  db: Queryable,
  table: string,
  columns: string[],
  conflictColumns: string[],
  rows: unknown[][],
): Promise<void> {
  const batchSize = Math.max(1, Math.floor(20_000 / columns.length));
  const updateColumns = columns.filter(
    (column) => !conflictColumns.includes(column),
  );
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flat().map((value) => value === "" ? null : value);
    const tuples = batch.map((_, rowIndex) => {
      const base = rowIndex * columns.length;
      return `(${columns.map((__, columnIndex) => `$${base + columnIndex + 1}`).join(", ")})`;
    });
    const update = updateColumns
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(", ");
    await db.query(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES ${tuples.join(", ")}
       ON CONFLICT (${conflictColumns.join(", ")}) DO UPDATE SET ${update}`,
      values,
    );
  }
}

async function ingestData(db: Queryable) {
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

  await upsertRows(db, "clients", [
    "client_id", "client_name", "age", "gender", "nationality",
    "country_of_residence", "tax_domicile", "booking_centre", "rm_id",
    "rm_name", "rm_desk", "base_currency", "wealth_band", "total_aum_usd",
    "life_stage", "source_of_wealth", "risk_profile", "risk_tolerance_score",
    "investment_horizon_years", "liquidity_needs", "objectives", "client_since",
    "kyc_review_due", "pep_status", "reporting_language",
  ], ["client_id"], clients.map((c) => [
      c.client_id, c.client_name, c.age, c.gender, c.nationality,
      c.country_of_residence, c.tax_domicile, c.booking_centre,
      c.rm_id, c.rm_name, c.rm_desk, c.base_currency, c.wealth_band,
      c.total_aum_usd, c.life_stage, c.source_of_wealth, c.risk_profile,
      c.risk_tolerance_score, c.investment_horizon_years, c.liquidity_needs,
      c.objectives, c.client_since, c.kyc_review_due, c.pep_status,
      c.reporting_language
  ]));

  const snapshots = ["2025-12-31", "2026-02-27", "2026-03-31", "2026-06-30", "2026-08-26"];
  await upsertRows(db, "portfolios", [
    "portfolio_id", "client_id", "portfolio_name", "mandate_code",
    "mandate_name", "service_model", "base_currency", "inception_date",
    "benchmark", "aum_usd_current",
  ], ["portfolio_id"], portfolios.map((p) => [
      p.portfolio_id, p.client_id, p.portfolio_name, p.mandate_code,
      p.mandate_name, p.service_model, p.base_currency, p.inception_date,
      p.benchmark, p.aum_usd_current
  ]));
  const portfolioAum = portfolios.flatMap((p) =>
    snapshots
      .filter((snapshot) => p[`aum_${snapshot}`] != null)
      .map((snapshot) => [p.portfolio_id, snapshot, p[`aum_${snapshot}`]]),
  );
  await upsertRows(
    db,
    "portfolio_aum",
    ["portfolio_id", "snapshot_date", "aum_base"],
    ["portfolio_id", "snapshot_date"],
    portfolioAum,
  );

  await upsertRows(db, "holdings", [
    "snapshot_date", "portfolio_id", "client_id", "instrument_id",
    "instrument_name", "asset_class", "sub_asset_class", "sector", "region",
    "instrument_ccy", "quantity", "price_local", "market_value_local",
    "portfolio_ccy", "market_value_base", "market_value_usd", "weight_pct",
    "avg_cost_local", "cost_basis_base", "unrealised_pnl_base",
    "unrealised_pnl_pct", "lending_value_base", "advance_rate_pct",
    "liquidity_tier", "valuation_date", "acquired_date",
  ], ["snapshot_date", "portfolio_id", "instrument_id"], holdings.map((h) => [
      h.snapshot_date, h.portfolio_id, h.client_id, h.instrument_id,
      h.instrument_name, h.asset_class, h.sub_asset_class, h.sector, h.region,
      h.instrument_ccy, h.quantity, h.price_local, h.market_value_local,
      h.portfolio_ccy, h.market_value_base, h.market_value_usd, h.weight_pct,
      h.avg_cost_local, h.cost_basis_base, h.unrealised_pnl_base,
      h.unrealised_pnl_pct, h.lending_value_base, h.advance_rate_pct,
      h.liquidity_tier, h.valuation_date, h.acquired_date
  ]));

  await upsertRows(db, "instruments", [
    "instrument_id", "instrument_name", "asset_class", "sub_asset_class",
    "sector", "region", "currency", "liquidity_tier", "underlying_reference",
    "sustainability_excluded", "concentration_limit_applies",
  ], ["instrument_id"], instruments.map((i) => [
      i.instrument_id, i.instrument_name, i.asset_class, i.sub_asset_class,
      i.sector, i.region, i.currency, i.liquidity_tier, i.underlying_reference,
      i.sustainability_excluded, i.concentration_limit_applies
  ]));
  const prices = instruments.flatMap((instrument) =>
    snapshots
      .filter((snapshot) => instrument[`price_${snapshot}`] != null)
      .map((snapshot) => [
        instrument.instrument_id,
        snapshot,
        instrument[`price_${snapshot}`],
      ]),
  );
  await upsertRows(
    db,
    "instrument_prices",
    ["instrument_id", "snapshot_date", "price"],
    ["instrument_id", "snapshot_date"],
    prices,
  );

  await upsertRows(db, "mandates", [
    "mandate_code", "mandate_name", "asset_class", "min_pct", "target_pct",
    "max_pct", "max_single_position_pct", "mandate_notes",
  ], ["mandate_code", "asset_class"], mandates.map((m) => [
      m.mandate_code, m.mandate_name, m.asset_class, m.min_pct, m.target_pct,
      m.max_pct, m.max_single_position_pct, m.mandate_notes
  ]));

  await upsertRows(db, "transactions", [
    "transaction_id", "trade_date", "settlement_date", "portfolio_id",
    "client_id", "transaction_type", "instrument_id", "instrument_name",
    "quantity", "price_local", "currency", "amount", "narrative",
  ], ["transaction_id"], transactions.map((t) => [
      t.transaction_id, t.trade_date, t.settlement_date, t.portfolio_id,
      t.client_id, t.transaction_type, t.instrument_id, t.instrument_name,
      t.quantity, t.price_local, t.currency, t.amount, t.narrative
  ]));

  await upsertRows(db, "credit_facilities", [
    "facility_id", "client_id", "collateral_portfolio_id", "facility_type",
    "facility_ccy", "credit_limit", "interest_rate_pct", "margin_call_ltv_pct",
    "utilisation_pct_current",
  ], ["facility_id"], facilities.map((f) => [
      f.facility_id, f.client_id, f.collateral_portfolio_id, f.facility_type,
      f.facility_ccy, f.credit_limit, f.interest_rate_pct, f.margin_call_ltv_pct,
      f.utilisation_pct_current
  ]));
  const facilitySnapshots = facilities.flatMap((facility) =>
    snapshots.map((snapshot) => [
      facility.facility_id,
      snapshot,
      facility[`drawn_${snapshot}`],
      facility[`collateral_market_value_${snapshot}`],
      facility[`lending_value_${snapshot}`],
      facility[`ltv_pct_${snapshot}`],
      facility[`headroom_${snapshot}`],
    ]),
  );
  await upsertRows(
    db,
    "facility_snapshots",
    ["facility_id", "snapshot_date", "drawn", "collateral_market_value",
      "lending_value", "ltv_pct", "headroom"],
    ["facility_id", "snapshot_date"],
    facilitySnapshots,
  );

  await upsertRows(db, "commitments", [
    "commitment_id", "client_id", "portfolio_id", "fund_name", "currency",
    "committed", "called_to_date", "uncalled", "expected_call_window",
  ], ["commitment_id"], commitments.map((c) => [
      c.commitment_id, c.client_id, c.portfolio_id, c.fund_name, c.currency,
      c.committed, c.called_to_date, c.uncalled, c.expected_call_window
  ]));

  await upsertRows(db, "planned_cash_needs", [
    "need_id", "client_id", "description", "currency", "amount", "due_from",
    "due_to", "recurrence", "certainty",
  ], ["need_id"], cashNeeds.map((n) => [
      n.need_id, n.client_id, n.description, n.currency, n.amount,
      n.due_from, n.due_to, n.recurrence, n.certainty
  ]));

  await upsertRows(db, "market_context", [
    "snapshot_date", "series_id", "series_name", "category", "unit", "value",
    "snapshot_label",
  ], ["snapshot_date", "series_id"], marketContext.map((m) => [
      m.snapshot_date, m.series_id, m.series_name, m.category, m.unit,
      m.value, m.snapshot_label
  ]));

  // Process FX rates - normalize to usd_per_unit
  const fxRates: unknown[][] = [];
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
      fxRates.push([fx.snapshot_date, ccy, usdPerUnit]);
    }
  }
  for (const snap of snapshots) {
    fxRates.push([snap, "USD", 1.0]);
  }
  await upsertRows(
    db,
    "fx_rates",
    ["snapshot_date", "ccy", "usd_per_unit"],
    ["snapshot_date", "ccy"],
    fxRates,
  );

  // Process events - synthesize event_id and tokenize
  // Sort events by date then description for deterministic IDs
  const sortedEvents = eventLog.sort((a, b) => {
    const aDate = String(a.event_date ?? "");
    const bDate = String(b.event_date ?? "");
    if (aDate !== bDate) {
      return aDate < bDate ? -1 : 1;
    }
    return String(a.description ?? "") < String(b.description ?? "") ? -1 : 1;
  });

  const events = sortedEvents.map((e, i) => {
    const eventId = `EVT-${String(i + 1).padStart(3, "0")}`;

    // Tokenize transmission
    const tokens = String(e.primary_transmission ?? "")
      .toLowerCase()
      .split(/[,;]/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    return [
      eventId, e.event_date, e.event_type, e.region, e.description,
      e.primary_transmission, e.severity, JSON.stringify(tokens)
    ];
  });
  await upsertRows(db, "events", [
    "event_id", "event_date", "event_type", "region", "description",
    "primary_transmission", "severity", "transmission_tokens",
  ], ["event_id"], events);

  await upsertRows(db, "rm_notes", [
    "note_id", "client_id", "note_date", "rm_id", "rm_name", "channel", "note",
  ], ["note_id"], rmNotes.map((n) => [
      n.note_id, n.client_id, n.note_date, n.rm_id, n.rm_name, n.channel, n.note
  ]));

  console.log("✓ All source data ingested");
}

async function detectDataQualityFlags(db: Queryable) {
  console.log("Detecting data quality flags...");

  // Missing cost basis
  const missingCost = (await db.query<MissingCostRow>(`
    SELECT DISTINCT snapshot_date, portfolio_id, client_id, instrument_id, instrument_name
    FROM holdings
    WHERE avg_cost_local IS NULL AND cost_basis_base IS NULL
    AND snapshot_date = '2026-08-26'
  `)).rows;

  const flags: unknown[][] = missingCost.map((row) => {
    const id = `FLAG-COST-${row.portfolio_id}-${row.instrument_id}`;
    return [
      id, "error", "position", `${row.portfolio_id}:${row.instrument_id}`,
      "MISSING_COST_BASIS",
      `Cost basis not provided for ${row.instrument_name}. Tax analysis unavailable.`,
      `holdings.csv:${row.snapshot_date}:${row.portfolio_id}:${row.instrument_id}`
    ];
  });

  // Pre-relationship snapshots (PF-0005)
  const preRelSnaps = (await db.query<PreRelationshipRow>(`
    SELECT DISTINCT h.portfolio_id, h.client_id, h.snapshot_date, c.client_since
    FROM holdings h
    JOIN clients c ON h.client_id = c.client_id
    WHERE h.snapshot_date < c.client_since
  `)).rows;

  for (const row of preRelSnaps) {
    const id = `FLAG-PREREL-${row.portfolio_id}`;
    flags.push([
      id, "warning", "portfolio", row.portfolio_id,
      "PRE_RELATIONSHIP_SNAPSHOT",
      `Holdings exist at ${row.snapshot_date}, before client_since ${row.client_since}. Baseline shifted.`,
      `holdings.csv:${row.portfolio_id}:${row.snapshot_date}`
    ]);
  }

  // Lagged private marks
  const laggedMarks = ["SYN-AL-0301", "SYN-AL-0305", "SYN-AL-0308"];
  for (const inst of laggedMarks) {
    const id = `FLAG-LAG-${inst}`;
    flags.push([
      id, "warning", "position", inst,
      "LAGGED_PRIVATE_MARK",
      "Private markets valuation lags by one quarter. Current mark may not reflect recent performance.",
      `instruments.csv:${inst}`
    ]);
  }
  await upsertRows(db, "data_quality_flags", [
    "flag_id", "severity", "scope_type", "scope_id", "code", "description",
    "source_ref",
  ], ["flag_id"], flags);

  console.log(`✓ Detected ${missingCost.length + preRelSnaps.length + laggedMarks.length} data quality flags`);
}

async function main() {
  console.log("=== Verity Data Ingestion ===\n");

  const db = createAdminDb();

  try {
    await withTransaction(db, async (client) => {
      console.log("Clearing previously seeded source and derived data...");
      await clearSeededData(client);
      console.log("Ingesting data...");
      await ingestData(client);
      console.log("Detecting data quality issues...");
      await detectDataQualityFlags(client);
    });

    // Print summary
    const counts = {
      clients: (await db.query<CountRow>("SELECT COUNT(*) AS count FROM clients")).rows[0],
      holdings: (await db.query<CountRow>("SELECT COUNT(*) AS count FROM holdings")).rows[0],
      events: (await db.query<CountRow>("SELECT COUNT(*) AS count FROM events")).rows[0],
      flags: (await db.query<CountRow>("SELECT COUNT(*) AS count FROM data_quality_flags")).rows[0],
    };

    console.log("\n=== Ingestion Summary ===");
    console.log(`Clients:     ${counts.clients.count}`);
    console.log(`Holdings:    ${counts.holdings.count}`);
    console.log(`Events:      ${counts.events.count}`);
    console.log(`DQ Flags:    ${counts.flags.count}`);
    console.log("\n✓ Ingestion complete");
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Ingestion failed:", error);
  process.exitCode = 1;
});
