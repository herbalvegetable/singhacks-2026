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

export async function buildDiversificationContext(
  signal: Signal,
  repository = new Repository(),
): Promise<DiversificationContext> {
  const syntheticQuery = [
    "Diversify the portfolio while aligning to client objectives, risk tolerance,",
    "investment horizon, liquidity needs, cash commitments, household concentration,",
    "mandate bands and current market risks.",
  ].join(" ");
  const [client, dates, pack, portfolios] = await Promise.all([
    repository.getClient(signal.client_id),
    repository.getSnapshotDates(),
    buildClientContextPack(signal.client_id, syntheticQuery, repository),
    repository.getPortfoliosForClient(signal.client_id),
  ]);
  if (!client) throw new Error("Client not found");
  const asOf = dates.at(-1);
  if (!asOf) throw new Error("No holding snapshots available");

  const [
    holdings,
    managedMandateGroups,
    cashNeeds,
    commitments,
    householdExposures,
    marketContextRows,
    events,
  ] = await Promise.all([
    repository.getHoldingsForClient(signal.client_id, asOf),
    Promise.all(
      portfolios
        .filter((portfolio) => portfolio.service_model.toLowerCase() !== "custody")
        .map((portfolio) =>
          repository.getMandatesForCode(portfolio.mandate_code),
        ),
    ),
    repository.getCashNeedsForClient(signal.client_id),
    repository.getCommitmentsForClient(signal.client_id),
    new LookThroughAnalyzer(repository).computeHouseholdExposures(
      signal.client_id,
      asOf,
    ),
    repository.getMarketContext(["2026-02-27", "2026-03-31", asOf]),
    repository.getEvents(),
  ]);
  const instruments = await repository.getInstruments(
    [...new Set(holdings.map((holding) => holding.instrument_id))],
  );
  const managedMandates = managedMandateGroups.flat();
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
    cashNeeds,
    commitments,
  });
  const topHouseholdExposures = householdExposures.slice(0, 15);
  const marketContext = marketContextRows
    .filter((row) =>
      ["SPX", "MSCI_ASIA_XJP", "BRENT_USD_BBL", "TTF_GAS_EUR_MWH", "UST_10Y_PCT", "VIX"].includes(
        row.series_id,
      ),
    );
  const recentEvents = events.slice(-8);
  const ragContext = {
    client_profile: { ...client },
    objectives: client.objectives,
    signal,
    household_exposures: topHouseholdExposures,
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
