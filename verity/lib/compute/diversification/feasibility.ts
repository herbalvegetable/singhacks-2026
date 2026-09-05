import type { AssetClass, TargetAllocation } from "../../contracts/diversification";
import type {
  CashNeed,
  Client,
  Commitment,
  Holding,
  Instrument,
  Mandate,
  Portfolio,
} from "../../db/repository";
import { ASSET_CLASSES } from "../scenario/assumptions";

export interface FeasibilityEnvelope {
  client: Client;
  asOf: string;
  baselineValueUsd: number;
  reservedCashUsd: number;
  currentAllocations: TargetAllocation[];
  holdings: Holding[];
  portfolios: Portfolio[];
  mandates: Mandate[];
  managedPortfolioMandates: Array<{
    portfolio: Portfolio;
    holdings: Holding[];
    mandates: Mandate[];
  }>;
  instruments: Instrument[];
  warnings: string[];
}

function assetClassTotals(holdings: Holding[]): Record<AssetClass, number> {
  const totals = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as Record<
    AssetClass,
    number
  >;
  for (const holding of holdings) {
    if (ASSET_CLASSES.includes(holding.asset_class as AssetClass)) {
      totals[holding.asset_class as AssetClass] += holding.market_value_usd;
    }
  }
  return totals;
}

export function buildFeasibilityEnvelope(input: {
  client: Client;
  asOf: string;
  holdings: Holding[];
  portfolios: Portfolio[];
  mandates: Mandate[];
  instruments: Instrument[];
  cashNeeds: CashNeed[];
  commitments: Commitment[];
}): FeasibilityEnvelope {
  const baselineValueUsd = input.holdings.reduce(
    (sum, holding) => sum + holding.market_value_usd,
    0,
  );
  if (baselineValueUsd <= 0) throw new Error("Client has no positive portfolio value");

  const reservedCashUsd =
    input.cashNeeds.reduce((sum, need) => sum + Math.max(0, need.amount), 0) +
    input.commitments.reduce((sum, commitment) => sum + Math.max(0, commitment.uncalled), 0);
  const totals = assetClassTotals(input.holdings);
  const mandateByClass = new Map(
    input.mandates.map((mandate) => [mandate.asset_class, mandate]),
  );
  const currentAllocations = ASSET_CLASSES.map((assetClass) => {
    const currentPct = (totals[assetClass] / baselineValueUsd) * 100;
    return {
      asset_class: assetClass,
      current_pct: Number(currentPct.toFixed(4)),
      target_pct: Number(
        (mandateByClass.get(assetClass)?.target_pct ?? currentPct).toFixed(4),
      ),
      delta_pct: Number(
        ((mandateByClass.get(assetClass)?.target_pct ?? currentPct) - currentPct).toFixed(4),
      ),
    };
  });
  const custodyPortfolios = input.portfolios.filter(
    (portfolio) => portfolio.service_model.toLowerCase() === "custody",
  );
  const warnings = [
    "Cash needs and commitments are treated as USD-equivalent because forward FX assumptions are unavailable.",
    ...(custodyPortfolios.length > 0
      ? [
          `Custody portfolio${custodyPortfolios.length > 1 ? "s" : ""} ${custodyPortfolios
            .map((portfolio) => portfolio.portfolio_id)
            .join(", ")} are shown as unmonitored exposures and are not mandate-tested.`,
        ]
      : []),
  ];
  const managedPortfolioMandates = input.portfolios
    .filter((portfolio) => portfolio.service_model.toLowerCase() !== "custody")
    .map((portfolio) => ({
      portfolio,
      holdings: input.holdings.filter(
        (holding) => holding.portfolio_id === portfolio.portfolio_id,
      ),
      mandates: input.mandates.filter(
        (mandate) => mandate.mandate_code === portfolio.mandate_code,
      ),
    }));

  return {
    client: input.client,
    asOf: input.asOf,
    baselineValueUsd,
    reservedCashUsd,
    currentAllocations,
    holdings: input.holdings,
    portfolios: input.portfolios,
    mandates: input.mandates,
    managedPortfolioMandates,
    instruments: input.instruments,
    warnings,
  };
}

export function envelopeForPrompt(envelope: FeasibilityEnvelope) {
  const holdings = envelope.holdings.map((holding) => ({
    instrument_id: holding.instrument_id,
    instrument_name: holding.instrument_name,
    asset_class: holding.asset_class,
    market_value_usd: holding.market_value_usd,
    liquidity_tier: holding.liquidity_tier,
    portfolio_id: holding.portfolio_id,
  }));
  return {
    as_of: envelope.asOf,
    baseline_value_usd: envelope.baselineValueUsd,
    reserved_cash_usd: envelope.reservedCashUsd,
    current_allocations: envelope.currentAllocations,
    managed_portfolio_mandates: envelope.managedPortfolioMandates.map(
      ({ portfolio, mandates }) => ({
        portfolio_id: portfolio.portfolio_id,
        portfolio_name: portfolio.portfolio_name,
        mandate_code: portfolio.mandate_code,
        mandate_name: portfolio.mandate_name,
        bands: mandates.map((mandate) => ({
          asset_class: mandate.asset_class,
          min_pct: mandate.min_pct,
          target_pct: mandate.target_pct,
          max_pct: mandate.max_pct,
          max_single_position_pct: mandate.max_single_position_pct,
        })),
      }),
    ),
    permitted_instruments: holdings,
    constraints: [
      "Every action must contain at least one buy and one sell.",
      "Trade amounts must net to zero.",
      "Do not sell more than the current market value.",
      "Do not propose selling Illiquid holdings.",
      "Each trade must identify the portfolio containing the position.",
      "Target allocations in each managed portfolio must remain inside that portfolio's mandate bands.",
      "Custody portfolios are visible context but are excluded from mandate testing.",
    ],
  };
}
