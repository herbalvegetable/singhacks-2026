import type {
  AssetClass,
  ProposedAction,
  TargetAllocation,
  TradeInstruction,
} from "../../contracts/diversification";
import { ASSET_CLASSES } from "../scenario/assumptions";
import {
  formatMandateCheckReason,
  type MandateCheck,
} from "../suitability";
import type { FeasibilityEnvelope } from "./feasibility";

export interface AppliedAction {
  action: ProposedAction;
  valuesByInstrument: Record<string, number>;
  valuesByPosition: Record<string, number>;
  targetAllocations: TargetAllocation[];
  mandateChecks: MandateCheck[];
  caveats: string[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function positionKey(portfolioId: string, instrumentId: string): string {
  return `${portfolioId}::${instrumentId}`;
}

function aggregateByInstrument(
  valuesByPosition: Record<string, number>,
  envelope: FeasibilityEnvelope,
): Record<string, number> {
  return envelope.holdings.reduce<Record<string, number>>((totals, holding) => {
    totals[holding.instrument_id] =
      (totals[holding.instrument_id] ?? 0) +
      (valuesByPosition[positionKey(holding.portfolio_id, holding.instrument_id)] ?? 0);
    return totals;
  }, {});
}

function netTradesWithinPortfolios(trades: TradeInstruction[]): void {
  const portfolioIds = [...new Set(trades.map((trade) => trade.portfolio_id))];
  for (const portfolioId of portfolioIds) {
    const portfolioTrades = trades.filter(
      (trade) => trade.portfolio_id === portfolioId,
    );
    const sells = portfolioTrades.filter((trade) => trade.direction === "sell");
    const buys = portfolioTrades.filter((trade) => trade.direction === "buy");
    const sellTotal = sells.reduce((sum, trade) => sum + trade.usd_amount, 0);
    const buyTotal = buys.reduce((sum, trade) => sum + trade.usd_amount, 0);
    const nettable = Math.min(sellTotal, buyTotal);
    sells.forEach((trade) => {
      trade.usd_amount = sellTotal > 0
        ? trade.usd_amount * nettable / sellTotal
        : 0;
    });
    buys.forEach((trade) => {
      trade.usd_amount = buyTotal > 0
        ? trade.usd_amount * nettable / buyTotal
        : 0;
    });
  }
}

function computeMandateChecks(
  valuesByPosition: Record<string, number>,
  envelope: FeasibilityEnvelope,
): MandateCheck[] {
  return envelope.managedPortfolioMandates.flatMap(
    ({ portfolio, holdings, mandates }) => {
      const portfolioValue = holdings.reduce(
        (sum, holding) =>
          sum +
          (valuesByPosition[positionKey(holding.portfolio_id, holding.instrument_id)] ?? 0),
        0,
      );
      return mandates.flatMap((mandate) => {
        const assetClass = mandate.asset_class as AssetClass;
        if (!ASSET_CLASSES.includes(assetClass)) return [];
        const classValue = holdings
          .filter((holding) => holding.asset_class === assetClass)
          .reduce(
            (sum, holding) =>
              sum +
              (valuesByPosition[positionKey(holding.portfolio_id, holding.instrument_id)] ?? 0),
            0,
          );
        const currentPct = portfolioValue > 0 ? (classValue / portfolioValue) * 100 : 0;
        const compliant =
          currentPct >= mandate.min_pct - 0.01 &&
          currentPct <= mandate.max_pct + 0.01;
        const mandateName =
          mandate.mandate_name || portfolio.mandate_name || mandate.mandate_code;
        return [{
          portfolio_id: portfolio.portfolio_id,
          portfolio_name: portfolio.portfolio_name,
          mandate_code: mandate.mandate_code,
          mandate_name: mandateName,
          asset_class: assetClass,
          min_pct: mandate.min_pct,
          max_pct: mandate.max_pct,
          current_pct: round(currentPct),
          compliant,
          reason: formatMandateCheckReason({
            mandateName,
            assetClass,
            currentPct,
            minPct: mandate.min_pct,
            maxPct: mandate.max_pct,
          }),
        }];
      });
    },
  );
}

export function applyAndRepairAction(
  proposed: ProposedAction,
  envelope: FeasibilityEnvelope,
): AppliedAction {
  const holdingByPosition = new Map(
    envelope.holdings.map((holding) => [
      positionKey(holding.portfolio_id, holding.instrument_id),
      holding,
    ]),
  );
  const instrumentById = new Map(
    envelope.instruments.map((instrument) => [instrument.instrument_id, instrument]),
  );
  const values = envelope.holdings.reduce<Record<string, number>>(
    (totals, holding) => {
      const key = positionKey(holding.portfolio_id, holding.instrument_id);
      totals[key] = (totals[key] ?? 0) + holding.market_value_usd;
      return totals;
    },
    {},
  );
  const caveats = [...proposed.caveats];
  const allowed: TradeInstruction[] = [];

  for (const trade of proposed.trades) {
    const key = positionKey(trade.portfolio_id, trade.instrument_id);
    const holding = holdingByPosition.get(key);
    if (!holding) {
      caveats.push(`${trade.instrument_id} was removed because it is not in the current portfolio.`);
      continue;
    }
    if (trade.direction === "sell" && holding.liquidity_tier === "Illiquid") {
      caveats.push(`${holding.instrument_name} was not sold because it is marked Illiquid.`);
      continue;
    }
    let amount = Math.max(0, trade.usd_amount);
    if (trade.direction === "sell") {
      amount = Math.min(amount, values[key]);
      if (holding.asset_class === "Cash and Equivalents") {
        const cashValue = envelope.holdings
          .filter((item) => item.asset_class === "Cash and Equivalents")
          .reduce((sum, item) => sum + item.market_value_usd, 0);
        amount = Math.min(amount, Math.max(0, cashValue - envelope.reservedCashUsd));
      }
    }
    if (amount > 0) allowed.push({ ...trade, usd_amount: amount });
  }

  for (const { portfolio, holdings, mandates } of envelope.managedPortfolioMandates) {
    const portfolioValue = holdings.reduce(
      (sum, holding) => sum + holding.market_value_usd,
      0,
    );
    for (const mandate of mandates) {
      const assetClass = mandate.asset_class as AssetClass;
      if (!ASSET_CLASSES.includes(assetClass)) continue;
      const matching = allowed.filter((trade) => {
        const holding = holdingByPosition.get(
          positionKey(trade.portfolio_id, trade.instrument_id),
        );
        return trade.portfolio_id === portfolio.portfolio_id &&
          holding?.asset_class === assetClass;
      });
      const buys = matching.filter((trade) => trade.direction === "buy");
      const sells = matching.filter((trade) => trade.direction === "sell");
      const buyTotal = buys.reduce((sum, trade) => sum + trade.usd_amount, 0);
      const sellTotal = sells.reduce((sum, trade) => sum + trade.usd_amount, 0);
      const currentValue = holdings
        .filter((holding) => holding.asset_class === assetClass)
        .reduce((sum, holding) => sum + holding.market_value_usd, 0);
      const maxBuy = Math.max(
        0,
        (mandate.max_pct / 100) * portfolioValue - currentValue + sellTotal,
      );
      const maxSell = Math.max(
        0,
        currentValue + buyTotal - (mandate.min_pct / 100) * portfolioValue,
      );
      if (buyTotal > maxBuy && buyTotal > 0) {
        const scale = maxBuy / buyTotal;
        buys.forEach((trade) => { trade.usd_amount *= scale; });
        caveats.push(
          `${portfolio.portfolio_name} ${assetClass} purchases were clipped to the mandate maximum.`,
        );
      }
      if (sellTotal > maxSell && sellTotal > 0) {
        const scale = maxSell / sellTotal;
        sells.forEach((trade) => { trade.usd_amount *= scale; });
        caveats.push(
          `${portfolio.portfolio_name} ${assetClass} sales were clipped to the mandate minimum.`,
        );
      }
    }
  }

  netTradesWithinPortfolios(allowed);
  const sells = allowed.filter(
    (trade) => trade.direction === "sell" && trade.usd_amount > 0,
  );
  const buys = allowed.filter(
    (trade) => trade.direction === "buy" && trade.usd_amount > 0,
  );
  if (sells.length === 0 || buys.length === 0) {
    throw new Error(`Action ${proposed.action_id} has no feasible, funded buy/sell pair`);
  }

  for (const trade of [...sells, ...buys]) {
    let amount = trade.usd_amount;
    const instrument = instrumentById.get(trade.instrument_id);
    const portfolio = envelope.portfolios.find(
      (candidate) => candidate.portfolio_id === trade.portfolio_id,
    );
    const applicableMandates = portfolio
      ? envelope.mandates.filter(
          (mandate) => mandate.mandate_code === portfolio.mandate_code,
        )
      : [];
    const maxSinglePositionPct = applicableMandates.length > 0
      ? Math.min(...applicableMandates.map((mandate) => mandate.max_single_position_pct))
      : 100;
    if (trade.direction === "buy" && instrument?.concentration_limit_applies === "Y") {
      const portfolioValue = envelope.holdings
        .filter((holding) => holding.portfolio_id === trade.portfolio_id)
        .reduce((sum, holding) => sum + holding.market_value_usd, 0);
      const key = positionKey(trade.portfolio_id, trade.instrument_id);
      const maximum = (maxSinglePositionPct / 100) * portfolioValue;
      amount = Math.min(amount, Math.max(0, maximum - values[key]));
      if (amount < trade.usd_amount) {
        caveats.push(`${trade.instrument_name} purchase was clipped to the single-position limit.`);
      }
    }
    trade.usd_amount = amount;
  }

  netTradesWithinPortfolios([...sells, ...buys]);
  const finalNettable = buys.reduce((sum, trade) => sum + trade.usd_amount, 0);
  if (finalNettable < 1) {
    throw new Error(`Action ${proposed.action_id} was eliminated by portfolio constraints`);
  }
  for (const trade of [...sells, ...buys]) {
    const sign = trade.direction === "buy" ? 1 : -1;
    const key = positionKey(trade.portfolio_id, trade.instrument_id);
    values[key] = Math.max(
      0,
      values[key] + sign * trade.usd_amount,
    );
  }

  const repairedTrades = [...sells, ...buys]
    .filter((trade) => trade.usd_amount >= 1)
    .map((trade) => ({ ...trade, usd_amount: round(trade.usd_amount) }));
  const totalByClass = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as Record<
    AssetClass,
    number
  >;
  for (const [key, value] of Object.entries(values)) {
    const holding = holdingByPosition.get(key);
    if (holding && ASSET_CLASSES.includes(holding.asset_class as AssetClass)) {
      totalByClass[holding.asset_class as AssetClass] += value;
    }
  }
  const targetAllocations = ASSET_CLASSES.map((assetClass) => {
    const current =
      envelope.currentAllocations.find((allocation) => allocation.asset_class === assetClass)
        ?.current_pct ?? 0;
    const target = (totalByClass[assetClass] / envelope.baselineValueUsd) * 100;
    return {
      asset_class: assetClass,
      current_pct: round(current),
      target_pct: round(target),
      delta_pct: round(target - current),
    };
  });

  return {
    action: {
      ...proposed,
      trades: repairedTrades,
      target_allocations: targetAllocations,
      caveats: [...new Set(caveats)],
    },
    valuesByInstrument: aggregateByInstrument(values, envelope),
    valuesByPosition: values,
    targetAllocations,
    mandateChecks: computeMandateChecks(values, envelope),
    caveats: [...new Set(caveats)],
  };
}

export function createConstraintAwareHold(
  proposed: ProposedAction,
  envelope: FeasibilityEnvelope,
  reason: string,
): AppliedAction {
  const valuesByPosition = envelope.holdings.reduce<Record<string, number>>(
    (totals, holding) => {
      totals[positionKey(holding.portfolio_id, holding.instrument_id)] =
        (totals[positionKey(holding.portfolio_id, holding.instrument_id)] ?? 0) +
        holding.market_value_usd;
      return totals;
    },
    {},
  );
  const targetAllocations = envelope.currentAllocations.map((allocation) => ({
    ...allocation,
    target_pct: allocation.current_pct,
    delta_pct: 0,
  }));
  const caveats = [
    ...proposed.caveats,
    reason,
    "No hypothetical trade was forced because doing so would violate the active feasibility constraints.",
  ];
  return {
    action: {
      ...proposed,
      title: `Constraint-aware review: ${proposed.title}`,
      trades: [],
      target_allocations: targetAllocations,
      caveats: [...new Set(caveats)],
    },
    valuesByInstrument: aggregateByInstrument(valuesByPosition, envelope),
    valuesByPosition,
    targetAllocations,
    mandateChecks: computeMandateChecks(valuesByPosition, envelope),
    caveats: [...new Set(caveats)],
  };
}
