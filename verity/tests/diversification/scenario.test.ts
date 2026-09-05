import assert from "node:assert/strict";
import test from "node:test";
import { CORRELATION_MATRIX, SCENARIOS } from "../../lib/compute/scenario/assumptions";
import { cholesky } from "../../lib/compute/scenario/rng";
import {
  runScenarioProjection,
  type AllocationWeights,
} from "../../lib/compute/scenario/monteCarlo";
import {
  applyAndRepairAction,
  createConstraintAwareHold,
} from "../../lib/compute/diversification/applyAction";
import type { FeasibilityEnvelope } from "../../lib/compute/diversification/feasibility";
import {
  ProposedAction as ProposedActionSchema,
  type ProposedAction,
} from "../../lib/contracts/diversification";
import {
  assessNarrativeSuitability,
  formatSuitabilityStatement,
} from "../../lib/compute/suitability";
import { assessPortfolioRisk } from "../../lib/compute/scenario/riskScore";

test("Cholesky factor reconstructs the declared correlation matrix", () => {
  const lower = cholesky(CORRELATION_MATRIX);
  for (let row = 0; row < CORRELATION_MATRIX.length; row += 1) {
    for (let column = 0; column < CORRELATION_MATRIX.length; column += 1) {
      let reconstructed = 0;
      for (let k = 0; k < CORRELATION_MATRIX.length; k += 1) {
        reconstructed += (lower[row][k] ?? 0) * (lower[column][k] ?? 0);
      }
      assert.ok(Math.abs(reconstructed - CORRELATION_MATRIX[row][column]) < 1e-9);
    }
  }
});

const cashWeights: AllocationWeights = {
  "Cash and Equivalents": 1,
  "Fixed Income": 0,
  Equity: 0,
  Alternatives: 0,
  Commodities: 0,
  "Structured Products": 0,
};

test("Monte Carlo projections are exactly reproducible for a seed", () => {
  const input = {
    actionId: "test",
    baselineValueUsd: 1_000_000,
    weights: cashWeights,
    scenario: SCENARIOS[0],
    seed: 42,
    paths: 300,
  };
  assert.deepEqual(runScenarioProjection(input), runScenarioProjection(input));
});

test("central all-cash P50 agrees with the lognormal median", () => {
  const baseline = 1_000_000;
  const result = runScenarioProjection({
    actionId: "cash",
    baselineValueUsd: baseline,
    weights: cashWeights,
    scenario: SCENARIOS[0],
    seed: 90210,
    paths: 4000,
  });
  const expectedMedian = baseline * Math.exp((0.0375 - 0.5 * 0.01 ** 2) * 3);
  assert.ok(Math.abs(result.terminal_p50 / expectedMedian - 1) < 0.005);
});

function holding(
  instrumentId: string,
  assetClass: string,
  value: number,
) {
  return {
    snapshot_date: "2026-08-26",
    portfolio_id: "PF-TEST",
    client_id: "CL-TEST",
    instrument_id: instrumentId,
    instrument_name: instrumentId,
    asset_class: assetClass,
    sub_asset_class: assetClass,
    sector: "Test",
    region: "Global",
    instrument_ccy: "USD",
    quantity: 1,
    price_local: value,
    market_value_usd: value,
    weight_pct: value / 10_000,
    cost_basis_base: value,
    unrealised_pnl_base: 0,
    unrealised_pnl_pct: 0,
    liquidity_tier: "Daily",
    advance_rate_pct: 0,
  };
}

const envelope: FeasibilityEnvelope = {
  client: {
    client_id: "CL-TEST",
    client_name: "Test Client",
    age: 45,
    tax_domicile: "SG",
    objectives: "Diversify",
    life_stage: "Accumulation",
    risk_profile: "Balanced",
    risk_tolerance_score: 5,
    investment_horizon_years: 10,
    liquidity_needs: "Medium",
    total_aum_usd: 1_000_000,
  },
  asOf: "2026-08-26",
  baselineValueUsd: 1_000_000,
  reservedCashUsd: 0,
  currentAllocations: [
    { asset_class: "Cash and Equivalents", current_pct: 0, target_pct: 0, delta_pct: 0 },
    { asset_class: "Fixed Income", current_pct: 50, target_pct: 40, delta_pct: -10 },
    { asset_class: "Equity", current_pct: 50, target_pct: 60, delta_pct: 10 },
    { asset_class: "Alternatives", current_pct: 0, target_pct: 0, delta_pct: 0 },
    { asset_class: "Commodities", current_pct: 0, target_pct: 0, delta_pct: 0 },
    { asset_class: "Structured Products", current_pct: 0, target_pct: 0, delta_pct: 0 },
  ],
  holdings: [
    holding("FI-1", "Fixed Income", 500_000),
    holding("EQ-1", "Equity", 500_000),
  ],
  portfolios: [
    {
      portfolio_id: "PF-TEST",
      client_id: "CL-TEST",
      portfolio_name: "Test",
      mandate_code: "TEST",
      mandate_name: "Test Balanced",
      service_model: "Advisory",
    },
  ],
  mandates: [
    {
      mandate_code: "TEST",
      mandate_name: "Test Balanced",
      asset_class: "Fixed Income",
      min_pct: 40,
      target_pct: 40,
      max_pct: 70,
      max_single_position_pct: 100,
      mandate_notes: "",
    },
    {
      mandate_code: "TEST",
      mandate_name: "Test Balanced",
      asset_class: "Equity",
      min_pct: 20,
      target_pct: 60,
      max_pct: 60,
      max_single_position_pct: 100,
      mandate_notes: "",
    },
  ],
  managedPortfolioMandates: [],
  instruments: [
    {
      instrument_id: "FI-1",
      instrument_name: "FI-1",
      asset_class: "Fixed Income",
      sub_asset_class: "Bond",
      sector: "Sovereign",
      region: "Global",
      currency: "USD",
      liquidity_tier: "Daily",
      underlying_reference: null,
      concentration_limit_applies: "N",
      sustainability_excluded: "N",
    },
    {
      instrument_id: "EQ-1",
      instrument_name: "EQ-1",
      asset_class: "Equity",
      sub_asset_class: "Stock",
      sector: "Technology",
      region: "Global",
      currency: "USD",
      liquidity_tier: "Daily",
      underlying_reference: null,
      concentration_limit_applies: "N",
      sustainability_excluded: "N",
    },
  ],
  warnings: [],
};
envelope.managedPortfolioMandates = [{
  portfolio: envelope.portfolios[0],
  holdings: envelope.holdings,
  mandates: envelope.mandates,
}];

test("action repair clips mandate breaches and keeps trades funded", () => {
  const action: ProposedAction = {
    action_id: "action-1",
    title: "Rebalance",
    thesis: "Test mandate repair",
    objective_alignment: ["Diversify"],
    trades: [
      {
        portfolio_id: "PF-TEST",
        instrument_id: "FI-1",
        instrument_name: "FI-1",
        direction: "sell",
        usd_amount: 300_000,
        rationale: "Reduce bonds",
      },
      {
        portfolio_id: "PF-TEST",
        instrument_id: "EQ-1",
        instrument_name: "EQ-1",
        direction: "buy",
        usd_amount: 300_000,
        rationale: "Add equity",
      },
    ],
    target_allocations: envelope.currentAllocations,
    caveats: [],
  };
  const repaired = applyAndRepairAction(action, envelope);
  const equity = repaired.targetAllocations.find(
    (allocation) => allocation.asset_class === "Equity",
  );
  assert.ok((equity?.target_pct ?? 100) <= 60.01);
  const buys = repaired.action.trades
    .filter((trade) => trade.direction === "buy")
    .reduce((sum, trade) => sum + trade.usd_amount, 0);
  const sells = repaired.action.trades
    .filter((trade) => trade.direction === "sell")
    .reduce((sum, trade) => sum + trade.usd_amount, 0);
  assert.ok(Math.abs(buys - sells) < 0.02);
  assert.ok(repaired.caveats.some((caveat) => /clipped/i.test(caveat)));
  assert.ok(repaired.mandateChecks.every((check) => check.compliant));
  assert.ok(
    repaired.mandateChecks.some(
      (check) =>
        check.portfolio_id === "PF-TEST" &&
        check.mandate_name === "Test Balanced" &&
        check.current_pct <= check.max_pct,
    ),
  );
});

test("suitability statements use numeric tolerance while presenting the profile", () => {
  const statement = formatSuitabilityStatement({
    riskProfile: "Balanced",
    riskToleranceScore: 5,
    riskScore: 55,
    toleranceCeiling: 60,
    riskGatePassed: true,
    mandateGatePassed: true,
  });
  assert.match(statement, /Risk profile: Balanced/);
  assert.match(statement, /risk tolerance 5\/10 as the numeric gate/);
  assert.match(statement, /55\/100.*60\/100/);
});

test("risk profile label cannot override the numeric tolerance gate", () => {
  const result = assessPortfolioRisk({
    allocations: cashWeights,
    positionWeights: [1],
    liquidityTiers: [{ weight: 1, tier: "Daily" }],
    mandateChecks: [],
    riskToleranceScore: 0,
    riskProfile: "Aggressive",
  });
  assert.equal(result.suitability?.risk_profile, "Aggressive");
  assert.equal(result.suitability?.risk_gate_passed, false);
  assert.equal(result.suitable_for_client, false);
});

test("free-form portfolio changes never claim quantified suitability", () => {
  const result = assessNarrativeSuitability({
    title: "Reduce concentration",
    rationale: "Trim the largest holding.",
    steps: ["Discuss the proposed rebalance."],
  });
  assert.equal(result.status, "requires_quantified_analysis");
  assert.match(result.statement, /quantified diversification analysis/i);
  assert.equal(
    assessNarrativeSuitability(null).status,
    "no_portfolio_change",
  );
});

test("constraint-aware fallback returns a valid plan instead of throwing", () => {
  const action: ProposedAction = {
    action_id: "action-1",
    title: "Unavailable rebalance",
    thesis: "Review constraints",
    objective_alignment: ["Diversify"],
    trades: [],
    target_allocations: envelope.currentAllocations,
    caveats: [],
  };
  const result = createConstraintAwareHold(
    action,
    envelope,
    "No feasible pair remains.",
  );
  assert.equal(result.action.trades.length, 0);
  assert.ok(result.action.caveats.some((caveat) => /no feasible pair/i.test(caveat)));
  assert.doesNotThrow(() => ProposedActionSchema.parse(result.action));
  assert.equal(
    Object.values(result.valuesByInstrument).reduce(
      (sum, value) => sum + value,
      0,
    ),
    envelope.baselineValueUsd,
  );
});

test("custody portfolios are excluded from mandate checks", () => {
  const custodyHolding = {
    ...holding("CASH-1", "Cash and Equivalents", 250_000),
    portfolio_id: "PF-CUSTODY",
  };
  const custodyEnvelope: FeasibilityEnvelope = {
    ...envelope,
    baselineValueUsd: 1_250_000,
    holdings: [...envelope.holdings, custodyHolding],
    portfolios: [
      ...envelope.portfolios,
      {
        portfolio_id: "PF-CUSTODY",
        client_id: "CL-TEST",
        portfolio_name: "External Custody",
        mandate_code: "CUSTODY",
        mandate_name: "Unmonitored",
        service_model: "Custody",
      },
    ],
  };
  const result = createConstraintAwareHold(
    {
      action_id: "action-custody",
      title: "Hold",
      thesis: "No change",
      objective_alignment: ["Diversify"],
      trades: [],
      target_allocations: envelope.currentAllocations,
      caveats: [],
    },
    custodyEnvelope,
    "No trade proposed.",
  );
  assert.ok(result.mandateChecks.length > 0);
  assert.ok(
    result.mandateChecks.every(
      (check) => check.portfolio_id !== "PF-CUSTODY",
    ),
  );
});
