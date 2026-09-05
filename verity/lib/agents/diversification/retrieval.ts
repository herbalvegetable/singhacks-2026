import { createHash } from "crypto";
import { buildClientContextPack } from "../copilot/retrieval";
import { LookThroughAnalyzer } from "../../compute/lookThrough";
import {
  buildFeasibilityEnvelope,
  type FeasibilityEnvelope,
} from "../../compute/diversification/feasibility";
import { SCENARIOS } from "../../compute/scenario/assumptions";
import { Repository } from "../../db/repository";
import type { Signal, SourceRef } from "../../contracts/signal";

export interface DiversificationContext {
  signal: Signal;
  envelope: FeasibilityEnvelope;
  ragContext: {
    client_profile: Record<string, unknown>;
    objectives: string;
    signal: Signal;
    household_exposures: unknown[];
    market_context: unknown[];
    recent_events: unknown[];
    price_history_note: string;
    retrieved_records: unknown[];
  };
  contextPackHash: string;
  sourceRefs: SourceRef[];
}

export function buildDiversificationContext(
  signal: Signal,
  repository = new Repository(),
): DiversificationContext {
  const client = repository.getClient(signal.client_id);
  if (!client) throw new Error("Client not found");
  const dates = repository.getSnapshotDates();
  const asOf = dates.at(-1);
  if (!asOf) throw new Error("No holding snapshots available");

  const syntheticQuery = [
    "Diversify the portfolio while aligning to client objectives, risk tolerance,",
    "investment horizon, liquidity needs, cash commitments, household concentration,",
    "mandate bands and current market risks.",
  ].join(" ");
  const pack = buildClientContextPack(signal.client_id, syntheticQuery, repository);
  const portfolios = repository.getPortfoliosForClient(signal.client_id);
  const holdings = repository.getHoldingsForClient(signal.client_id, asOf);
  const instruments = repository.getInstruments(
    [...new Set(holdings.map((holding) => holding.instrument_id))],
  );
  const managedMandates = portfolios
    .filter((portfolio) => portfolio.service_model.toLowerCase() !== "custody")
    .flatMap((portfolio) => repository.getMandatesForCode(portfolio.mandate_code));
  const mandates = [
    ...new Map(
      managedMandates.map((mandate) => [
        `${mandate.mandate_code}:${mandate.asset_class}`,
        mandate,
      ]),
    ).values(),
  ];
  const envelope = buildFeasibilityEnvelope({
    client,
    asOf,
    holdings,
    portfolios,
    mandates,
    instruments,
    cashNeeds: repository.getCashNeedsForClient(signal.client_id),
    commitments: repository.getCommitmentsForClient(signal.client_id),
  });
  const householdExposures = new LookThroughAnalyzer(repository)
    .computeHouseholdExposures(signal.client_id, asOf)
    .slice(0, 15);
  const marketContext = repository
    .getMarketContext(["2026-02-27", "2026-03-31", asOf])
    .filter((row) =>
      ["SPX", "MSCI_ASIA_XJP", "BRENT_USD_BBL", "TTF_GAS_EUR_MWH", "UST_10Y_PCT", "VIX"].includes(
        row.series_id,
      ),
    );
  const recentEvents = repository.getEvents().slice(-8);
  const ragContext = {
    client_profile: { ...client },
    objectives: client.objectives,
    signal,
    household_exposures: householdExposures,
    market_context: marketContext,
    recent_events: recentEvents,
    price_history_note:
      "Only four instrument return observations exist. They are evidence for historical attribution, not inputs to covariance estimation.",
    retrieved_records: pack.records,
  };
  const contextPackHash = createHash("sha256")
    .update(JSON.stringify({ pack_hash: pack.context_pack_hash, ragContext, envelope }))
    .digest("hex");
  const sourceRefs = [
    ...signal.evidence,
    ...SCENARIOS.flatMap((scenario) => scenario.sourceRefs),
  ].filter(
    (reference, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.source === reference.source &&
          JSON.stringify(candidate.key) === JSON.stringify(reference.key),
      ) === index,
  );

  return { signal, envelope, ragContext, contextPackHash, sourceRefs };
}
