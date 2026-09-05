import type { AssetClass, AssumptionDisclosure } from "../../contracts/diversification";
import type { SourceRef } from "../../contracts/signal";

export const ASSUMPTION_SET_VERSION = "verity-cma-2026.2";

export const ASSET_CLASSES: AssetClass[] = [
  "Cash and Equivalents",
  "Fixed Income",
  "Equity",
  "Alternatives",
  "Commodities",
  "Structured Products",
];

export interface CapitalMarketAssumption {
  expectedReturn: number;
  volatility: number;
  rationale: string;
}

export const CAPITAL_MARKET_ASSUMPTIONS: Record<AssetClass, CapitalMarketAssumption> = {
  "Cash and Equivalents": {
    expectedReturn: 0.0375,
    volatility: 0.01,
    rationale: "Anchored to the current 3.75% upper bound of the Fed funds target.",
  },
  "Fixed Income": {
    expectedReturn: 0.0466,
    volatility: 0.065,
    rationale: "Anchored to the current 4.66% US Treasury 10-year yield with a diversified bond volatility assumption.",
  },
  Equity: {
    expectedReturn: 0.0725,
    volatility: 0.18,
    rationale: "Long-horizon nominal global equity assumption; not estimated from the four available return periods.",
  },
  Alternatives: {
    expectedReturn: 0.065,
    volatility: 0.13,
    rationale: "Blended private-market and hedge-fund assumption with an explicit illiquidity risk allowance.",
  },
  Commodities: {
    expectedReturn: 0.04,
    volatility: 0.22,
    rationale: "Inflation-sensitive real-asset assumption; recent conflict moves are handled separately as scenario shocks.",
  },
  "Structured Products": {
    expectedReturn: 0.06,
    volatility: 0.16,
    rationale: "Indicative risk-asset return with option-like downside; product payoffs are not fully observable in the dataset.",
  },
};

export const CORRELATION_MATRIX: number[][] = [
  [1, 0.15, 0.05, 0, 0.05, 0.1],
  [0.15, 1, 0.2, 0.1, -0.05, 0.3],
  [0.05, 0.2, 1, 0.55, 0.25, 0.65],
  [0, 0.1, 0.55, 1, 0.2, 0.45],
  [0.05, -0.05, 0.25, 0.2, 1, 0.15],
  [0.1, 0.3, 0.65, 0.45, 0.15, 1],
];

export type FactorId = "global_equity" | "oil" | "gas" | "rates_10y" | "volatility";

export const FACTOR_SENSITIVITIES: Record<AssetClass, Record<FactorId, number>> = {
  "Cash and Equivalents": { global_equity: 0, oil: 0, gas: 0, rates_10y: 0.2, volatility: 0 },
  "Fixed Income": { global_equity: 0.05, oil: -0.02, gas: -0.01, rates_10y: -4, volatility: -0.01 },
  Equity: { global_equity: 0.8, oil: -0.06, gas: -0.02, rates_10y: -1.2, volatility: -0.035 },
  Alternatives: { global_equity: 0.35, oil: 0.04, gas: 0.01, rates_10y: -1.5, volatility: -0.02 },
  Commodities: { global_equity: 0.05, oil: 0.4, gas: 0.12, rates_10y: -0.2, volatility: 0.01 },
  "Structured Products": { global_equity: 0.55, oil: -0.02, gas: -0.01, rates_10y: -2.2, volatility: -0.03 },
};

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  shockMonth: number | null;
  factorShocks: Record<FactorId, number>;
  sourceRefs: SourceRef[];
}

const marketRef = (
  snapshotDate: string,
  seriesId: string,
  value: number,
  comparisonDate?: string,
): SourceRef => ({
  source: "market_context.csv",
  key: { snapshot_date: snapshotDate, series_id: seriesId },
  fields: ["value", "snapshot_label"],
  values: { value, ...(comparisonDate ? { comparison_date: comparisonDate } : {}) },
});

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "central",
    name: "Central",
    description: "Capital-market-assumption drift with no discrete market shock.",
    shockMonth: null,
    factorShocks: { global_equity: 0, oil: 0, gas: 0, rates_10y: 0, volatility: 0 },
    sourceRefs: [],
  },
  {
    id: "hormuz-reescalation",
    name: "Hormuz Re-escalation",
    description: "Replays the observed pre-conflict to post-closure factor moves.",
    shockMonth: 3,
    factorShocks: {
      global_equity: -0.031,
      oil: 104 / 72.4 - 1,
      gas: 78 / 34.5 - 1,
      rates_10y: 0.004,
      volatility: 31.4 / 17.8 - 1,
    },
    sourceRefs: [
      marketRef("2026-03-31", "BRENT_USD_BBL", 104, "2026-02-27"),
      marketRef("2026-03-31", "TTF_GAS_EUR_MWH", 78, "2026-02-27"),
      marketRef("2026-03-31", "UST_10Y_PCT", 4.35, "2026-02-27"),
      marketRef("2026-03-31", "VIX", 31.4, "2026-02-27"),
      marketRef("2026-03-31", "MSCI_ASIA_XJP", 727, "2026-02-27"),
    ],
  },
  {
    id: "deescalation",
    name: "De-escalation",
    description: "Oil, gas and volatility normalise toward pre-conflict levels while risk assets recover.",
    shockMonth: 3,
    factorShocks: {
      global_equity: 0.045,
      oil: 72.4 / 101.5 - 1,
      gas: 34.5 / 68 - 1,
      rates_10y: -0.004,
      volatility: 17.8 / 25.1 - 1,
    },
    sourceRefs: [
      marketRef("2026-08-26", "BRENT_USD_BBL", 101.5, "2026-02-27"),
      marketRef("2026-08-26", "TTF_GAS_EUR_MWH", 68, "2026-02-27"),
      marketRef("2026-08-26", "VIX", 25.1, "2026-02-27"),
    ],
  },
  {
    id: "rate-shock",
    name: "Rate Shock Persistence",
    description: "The US Treasury 10-year yield rises another 60 basis points and remains elevated.",
    shockMonth: 3,
    factorShocks: {
      global_equity: -0.025,
      oil: 0,
      gas: 0,
      rates_10y: 0.006,
      volatility: 0.15,
    },
    sourceRefs: [
      marketRef("2025-12-31", "UST_10Y_PCT", 4.05, "2026-08-26"),
      marketRef("2026-08-26", "UST_10Y_PCT", 4.66, "2025-12-31"),
    ],
  },
];

export function assetClassShock(
  assetClass: AssetClass,
  scenario: ScenarioDefinition,
): number {
  const sensitivities = FACTOR_SENSITIVITIES[assetClass];
  return (Object.keys(scenario.factorShocks) as FactorId[]).reduce(
    (sum, factor) => sum + sensitivities[factor] * scenario.factorShocks[factor],
    0,
  );
}

export function assumptionDisclosures(): AssumptionDisclosure[] {
  return ASSET_CLASSES.map((assetClass) => ({
    asset_class: assetClass,
    expected_return_pct: CAPITAL_MARKET_ASSUMPTIONS[assetClass].expectedReturn * 100,
    volatility_pct: CAPITAL_MARKET_ASSUMPTIONS[assetClass].volatility * 100,
    rationale: CAPITAL_MARKET_ASSUMPTIONS[assetClass].rationale,
  }));
}
