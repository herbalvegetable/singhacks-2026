import { Repository } from "../db/repository";
import type { Signal, SourceRef } from "../contracts/signal";

interface PositionChange {
  instrument_id: string;
  instrument_name: string;
  portfolio_id: string;
  from_date: string;
  to_date: string;
  delta_market_value: number;
  price_effect: number;
  quantity_effect: number;
  fx_effect: number;
  residual: number;
  attribution: "market_driven" | "client_directed" | "unexplained_quantity_change";
  matching_transaction_id?: string;
}

export class SnapshotDiffer {
  constructor(private repo: Repository) {}

  async computePositionChanges(
    portfolioId: string,
    fromDate: string,
    toDate: string
  ): Promise<PositionChange[]> {
    const [fromHoldings, toHoldings, transactions] = await Promise.all([
      this.repo.getHoldingsForPortfolio(portfolioId, fromDate),
      this.repo.getHoldingsForPortfolio(portfolioId, toDate),
      this.repo.getTransactionsInWindow(portfolioId, fromDate, toDate),
    ]);

    const changes: PositionChange[] = [];
    const toMap = new Map(toHoldings.map((h) => [h.instrument_id, h]));
    const fromMap = new Map(fromHoldings.map((h) => [h.instrument_id, h]));

    // Find all instruments present in either snapshot
    const allInstruments = new Set([
      ...fromHoldings.map((h) => h.instrument_id),
      ...toHoldings.map((h) => h.instrument_id),
    ]);

    for (const instId of allInstruments) {
      const from = fromMap.get(instId);
      const to = toMap.get(instId);

      if (!from && !to) continue;

      const fromQty = from?.quantity || 0;
      const toQty = to?.quantity || 0;
      const fromPrice = from?.price_local || 0;
      const toPrice = to?.price_local || 0;
      const fromMV = from?.market_value_usd || 0;
      const toMV = to?.market_value_usd || 0;

      const deltaMV = toMV - fromMV;

      // Simple decomposition (ignoring FX for now in this simplified version)
      const priceEffect = (toPrice - fromPrice) * fromQty;
      const quantityEffect = (toQty - fromQty) * toPrice;
      const fxEffect = 0; // Simplified
      const residual = deltaMV - (priceEffect + quantityEffect + fxEffect);

      // Classify
      let attribution: PositionChange["attribution"] = "market_driven";
      let matchingTxnId: string | undefined;

      const qtyChangeThreshold = Math.abs(toQty - fromQty) / Math.max(fromQty, 1) > 0.01;

      if (qtyChangeThreshold) {
        // Look for matching transaction
        const match = transactions.find(
          (t) =>
            t.instrument_id === instId &&
            ["Buy", "Sell", "Structured Product Subscription", "Redemption Request", "Capital Call"].includes(
              t.transaction_type
            )
        );

        if (match) {
          attribution = "client_directed";
          matchingTxnId = match.transaction_id;
        } else if (Math.abs(toQty - fromQty) > 0.0001) {
          attribution = "unexplained_quantity_change";
        }
      }

      changes.push({
        instrument_id: instId,
        instrument_name: to?.instrument_name || from?.instrument_name || instId,
        portfolio_id: portfolioId,
        from_date: fromDate,
        to_date: toDate,
        delta_market_value: deltaMV,
        price_effect: priceEffect,
        quantity_effect: quantityEffect,
        fx_effect: fxEffect,
        residual,
        attribution,
        matching_transaction_id: matchingTxnId,
      });
    }

    return changes.filter((c) => Math.abs(c.delta_market_value) > 100); // Filter noise
  }

  generateDurationSignal(
    clientId: string,
    portfolioId: string,
    changes: PositionChange[]
  ): Signal | null {
    // Find fixed income losses driven by price
    const fiLosses = changes.filter(
      (c) =>
        c.delta_market_value < 0 &&
        Math.abs(c.price_effect) > Math.abs(c.quantity_effect)
    );

    if (fiLosses.length === 0) return null;

    const totalLoss = fiLosses.reduce((sum, c) => sum + c.delta_market_value, 0);

    const evidence: SourceRef[] = fiLosses.slice(0, 5).map((c) => ({
      source: "holdings.csv" as const,
      key: {
        snapshot_date: c.to_date,
        portfolio_id: c.portfolio_id,
        instrument_id: c.instrument_id,
      },
      fields: ["market_value_usd", "price_local", "unrealised_pnl_base"],
      values: {
        delta: c.delta_market_value,
        price_effect: c.price_effect,
      },
    }));

    return {
      signal_id: `SIG-${clientId}-${portfolioId}-DURATION`,
      client_id: clientId,
      portfolio_ids: [portfolioId],
      type: "explanation",
      subtype: "duration_attribution",
      headline: `Fixed income down ${Math.abs(totalLoss).toFixed(0)} USD driven by duration`,
      window: { from: changes[0]?.from_date || "", to: changes[0]?.to_date || "" },
      magnitude_usd: totalLoss,
      magnitude_pct: null,
      direction: "negative",
      urgency_score: 40,
      urgency_breakdown: {
        materiality: 25,
        time_proximity: 15,
      },
      affected_holdings: fiLosses.slice(0, 5).map((c) => ({
        instrument_id: c.instrument_id,
        instrument_name: c.instrument_name,
        portfolio_id: c.portfolio_id,
        market_value_usd: Math.abs(c.delta_market_value),
        weight_pct: 0,
      })),
      evidence,
      data_quality_flags: [],
      computed_at: new Date().toISOString(),
    };
  }
}
