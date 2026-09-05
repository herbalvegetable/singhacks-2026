import { Repository, type Holding } from "../db/repository";
import { resolveLookThrough } from "./underlyingMap";
import type { Signal, SourceRef } from "../contracts/signal";

interface HouseholdExposure {
  client_id: string;
  resolved_instrument_id: string;
  resolved_instrument_name: string;
  total_market_value_usd: number;
  total_weight_pct: number;
  components: Array<{
    portfolio_id: string;
    instrument_id: string;
    direct: boolean;
    weight_in_basket: number;
    market_value_usd: number;
  }>;
}

export class LookThroughAnalyzer {
  constructor(private repo: Repository) {}

  async computeHouseholdExposures(
    clientId: string,
    snapshotDate: string
  ): Promise<HouseholdExposure[]> {
    const holdings = await this.repo.getHoldingsForClient(clientId, snapshotDate);
    const totalAUM = holdings.reduce((sum, h) => sum + h.market_value_usd, 0);
    const resolvedInstrumentIds = new Set(holdings.map((holding) => holding.instrument_id));
    for (const holding of holdings) {
      const lookThrough = resolveLookThrough(holding.instrument_id);
      for (const component of lookThrough?.components ?? []) {
        resolvedInstrumentIds.add(component.instrument_id);
      }
    }
    const instruments = await this.repo.getInstruments([...resolvedInstrumentIds]);
    const instrumentNames = new Map(
      instruments.map((instrument) => [
        instrument.instrument_id,
        instrument.instrument_name,
      ]),
    );

    // Map to accumulate exposures
    const exposureMap = new Map<string, HouseholdExposure>();

    for (const holding of holdings) {
      // Direct exposure
      this.addExposure(exposureMap, instrumentNames, clientId, holding, totalAUM, {
        portfolio_id: holding.portfolio_id,
        instrument_id: holding.instrument_id,
        direct: true,
        weight_in_basket: 1.0,
        market_value_usd: holding.market_value_usd,
      });

      // Look-through
      const lookThrough = resolveLookThrough(holding.instrument_id);
      if (lookThrough && lookThrough.components.length > 0) {
        for (const component of lookThrough.components) {
          const componentValue = holding.market_value_usd * component.weight;
          this.addExposure(exposureMap, instrumentNames, clientId, holding, totalAUM, {
            portfolio_id: holding.portfolio_id,
            instrument_id: component.instrument_id,
            direct: false,
            weight_in_basket: component.weight,
            market_value_usd: componentValue,
          });
        }
      }
    }

    return Array.from(exposureMap.values()).sort(
      (a, b) => b.total_market_value_usd - a.total_market_value_usd
    );
  }

  private addExposure(
    map: Map<string, HouseholdExposure>,
    instrumentNames: Map<string, string>,
    clientId: string,
    holding: Holding,
    totalAUM: number,
    component: HouseholdExposure["components"][0]
  ) {
    const key = component.instrument_id;
    const existing = map.get(key);

    if (existing) {
      existing.total_market_value_usd += component.market_value_usd;
      existing.total_weight_pct = (existing.total_market_value_usd / totalAUM) * 100;
      existing.components.push(component);
    } else {
      map.set(key, {
        client_id: clientId,
        resolved_instrument_id: component.instrument_id,
        resolved_instrument_name:
          instrumentNames.get(component.instrument_id) || component.instrument_id,
        total_market_value_usd: component.market_value_usd,
        total_weight_pct: (component.market_value_usd / totalAUM) * 100,
        components: [component],
      });
    }
  }

  generateConcentrationSignal(
    clientId: string,
    exposures: HouseholdExposure[],
    threshold: number = 15.0
  ): Signal | null {
    const concentrated = exposures.find((e) => e.total_weight_pct > threshold);
    if (!concentrated) return null;

    const evidence: SourceRef[] = concentrated.components.slice(0, 5).map((c) => ({
      source: "holdings.csv" as const,
      key: {
        portfolio_id: c.portfolio_id,
        instrument_id: c.instrument_id,
      },
      fields: ["market_value_usd", "weight_pct"],
      values: {
        market_value_usd: c.market_value_usd,
        direct: c.direct,
      },
    }));

    return {
      signal_id: `SIG-${clientId}-CONC-${concentrated.resolved_instrument_id}`,
      client_id: clientId,
      portfolio_ids: [...new Set(concentrated.components.map((c) => c.portfolio_id))],
      type: "risk",
      subtype: "lookthrough_concentration",
      headline: `Household ${concentrated.total_weight_pct.toFixed(1)}% concentrated in ${concentrated.resolved_instrument_name}`,
      window: { from: "", to: "" },
      magnitude_usd: concentrated.total_market_value_usd,
      magnitude_pct: concentrated.total_weight_pct,
      direction: "negative",
      urgency_score: 70,
      urgency_breakdown: {
        materiality: 30,
        risk_severity: 40,
      },
      affected_holdings: concentrated.components.map((c) => ({
        instrument_id: c.instrument_id,
        instrument_name: concentrated.resolved_instrument_name,
        portfolio_id: c.portfolio_id,
        market_value_usd: c.market_value_usd,
        weight_pct: 0,
      })),
      evidence,
      data_quality_flags: [],
      computed_at: new Date().toISOString(),
    };
  }
}
