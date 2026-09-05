import { createHash } from "crypto";
import {
  DiversificationPlan,
  type AssetClass,
  type DiversificationActionResult,
  type ProposedAction,
} from "../../contracts/diversification";
import { Repository } from "../../db/repository";
import {
  applyAndRepairAction,
  createConstraintAwareHold,
} from "../../compute/diversification/applyAction";
import {
  ASSUMPTION_SET_VERSION,
  SCENARIOS,
  assumptionDisclosures,
} from "../../compute/scenario/assumptions";
import {
  normalizeWeights,
  runScenarioProjection,
  stringSeed,
} from "../../compute/scenario/monteCarlo";
import { assessPortfolioRisk } from "../../compute/scenario/riskScore";
import { buildDiversificationContext } from "./retrieval";
import {
  deterministicActionTemplates,
  fallbackAction,
  proposeDiversificationActions,
} from "./actionAgent";
import {
  fallbackActionSummary,
  summarizeDiversificationAction,
} from "./summaryAgent";

export type ProgressStage =
  | "retrieval"
  | "constraints"
  | "actions"
  | "validation"
  | "simulation"
  | "summaries"
  | "complete"
  | "cached";

export interface ProgressUpdate {
  stage: ProgressStage;
  message: string;
  payload?: unknown;
}

type ProgressHandler = (update: ProgressUpdate) => void | Promise<void>;
const SUITABILITY_VERSION = "portfolio-suitability-2026.1";

async function confidenceCeiling(
  repository: Repository,
  clientId: string,
  signalId: string,
): Promise<number> {
  const [flags, narratives] = await Promise.all([
    repository.getClientDataQualityFlags(clientId),
    repository.getNarrativesForClient(clientId),
  ]);
  const hasLaggedMark = flags.some((flag) => flag.code === "LAGGED_PRIVATE_MARK");
  const narrative = narratives[signalId];
  const narrativeConfidence =
    typeof narrative === "object" &&
    narrative !== null &&
    "confidence" in narrative &&
    typeof narrative.confidence === "number"
      ? narrative.confidence
      : 80;
  return Math.max(20, Math.min(hasLaggedMark ? 60 : 75, narrativeConfidence - 5));
}

function allocationsFromAction(action: ProposedAction) {
  return normalizeWeights(
    Object.fromEntries(
      action.target_allocations.map((allocation) => [
        allocation.asset_class,
        allocation.target_pct / 100,
      ]),
    ) as Partial<Record<AssetClass, number>>,
  );
}

export async function generateDiversificationPlan(
  signalId: string,
  onProgress: ProgressHandler = () => undefined,
  repository = new Repository(),
): Promise<DiversificationPlan> {
  const signal = await repository.getSignal(signalId);
  if (!signal) throw new Error("Signal not found");

  await onProgress({ stage: "retrieval", message: "Retrieving client objectives and portfolio evidence" });
  const context = await buildDiversificationContext(signal, repository);
  const inputHash = createHash("sha256")
    .update(
      `${context.contextPackHash}:${ASSUMPTION_SET_VERSION}:${SUITABILITY_VERSION}`,
    )
    .digest("hex");
  const cached = await repository.getDiversificationPlan(signalId, inputHash);
  if (cached) {
    await onProgress({
      stage: "cached",
      message: "Loaded a matching, previously validated scenario analysis",
      payload: cached,
    });
    return cached;
  }

  await onProgress({
    stage: "constraints",
    message: "Building mandate, liquidity and reserved-cash constraints",
    payload: {
      baseline_value_usd: context.envelope.baselineValueUsd,
      reserved_cash_usd: context.envelope.reservedCashUsd,
    },
  });
  await onProgress({ stage: "actions", message: "Generating three objectives-aligned diversification approaches" });
  let proposed: ProposedAction[];
  try {
    proposed = await proposeDiversificationActions(context);
  } catch (error) {
    console.error("Diversification action generation fallback:", error);
    proposed = deterministicActionTemplates(context.envelope);
    await onProgress({
      stage: "actions",
      message:
        "The model proposal was unavailable; continuing with deterministic objectives-aligned action templates",
    });
  }

  await onProgress({ stage: "validation", message: "Validating and repairing proposed trades deterministically" });
  const applied = proposed.map((action, index) => {
    try {
      return applyAndRepairAction(action, context.envelope);
    } catch (initialError) {
      const attempts = Math.max(1, context.envelope.holdings.length * 2);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return applyAndRepairAction(
            fallbackAction(
              action,
              context.envelope,
              index + attempt,
            ),
            context.envelope,
          );
        } catch {
          // Try the next funded holding pair.
        }
      }
      return createConstraintAwareHold(
        action,
        context.envelope,
        initialError instanceof Error
          ? `The generated trades were infeasible: ${initialError.message}.`
          : "The generated trades were infeasible.",
      );
    }
  });
  await onProgress({
    stage: "actions",
    message: "Validated three mandate-aware actions with safe fallbacks",
    payload: applied.map((result) => result.action),
  });

  await onProgress({ stage: "simulation", message: "Running seeded 36-month Monte Carlo and event shocks" });
  const baselineWeights = normalizeWeights(
    Object.fromEntries(
      context.envelope.currentAllocations.map((allocation) => [
        allocation.asset_class,
        allocation.current_pct / 100,
      ]),
    ) as Partial<Record<AssetClass, number>>,
  );
  const baselineProjections = SCENARIOS.map((scenario) =>
    runScenarioProjection({
      actionId: "hold-current",
      baselineValueUsd: context.envelope.baselineValueUsd,
      weights: baselineWeights,
      scenario,
      seed: stringSeed(`${signalId}:common-market-paths:${ASSUMPTION_SET_VERSION}`),
    }),
  );
  const confidence = await confidenceCeiling(repository, signal.client_id, signalId);

  const calculated = applied.map((result) => {
    const weights = allocationsFromAction(result.action);
    const projections = SCENARIOS.map((scenario) =>
      runScenarioProjection({
        actionId: result.action.action_id,
        baselineValueUsd: context.envelope.baselineValueUsd,
        weights,
        scenario,
        seed: stringSeed(`${signalId}:common-market-paths:${ASSUMPTION_SET_VERSION}`),
      }),
    );
    const positionEntries = context.envelope.holdings.map((holding) => ({
      value:
        result.valuesByPosition[
          `${holding.portfolio_id}::${holding.instrument_id}`
        ] ?? 0,
      tier: holding.liquidity_tier,
    }));
    const risk = assessPortfolioRisk({
      allocations: weights,
      positionWeights: positionEntries.map(
        (entry) => entry.value / context.envelope.baselineValueUsd,
      ),
      liquidityTiers: positionEntries.map((entry) => ({
        weight: entry.value / context.envelope.baselineValueUsd,
        tier: entry.tier,
      })),
      mandateChecks: result.mandateChecks,
      riskToleranceScore: context.envelope.client.risk_tolerance_score,
      riskProfile: context.envelope.client.risk_profile,
    });
    return { action: result.action, risk, projections };
  });

  await onProgress({
    stage: "simulation",
    message: "Completed Central, Hormuz, de-escalation and persistent-rate projections",
    payload: {
      baseline: baselineProjections,
      actions: calculated.map(({ action, risk, projections }) => ({
        action_id: action.action_id,
        risk,
        projections,
      })),
    },
  });
  await onProgress({ stage: "summaries", message: "Generating an RM summary for each computed action" });
  const summaries = await Promise.all(
    calculated.map(async ({ action, risk, projections }) => {
      try {
        return await summarizeDiversificationAction({
          clientObjectives: context.envelope.client.objectives,
          action,
          risk,
          projections,
          confidenceCeiling: confidence,
        });
      } catch (error) {
        console.error(
          `Diversification summary fallback for ${action.action_id}:`,
          error,
        );
        return fallbackActionSummary({
          action,
          risk,
          projections,
          confidenceCeiling: confidence,
        });
      }
    }),
  );
  const actions: DiversificationActionResult[] = calculated.map((result, index) => ({
    ...result,
    summary: summaries[index],
  }));
  const generatedAt = new Date().toISOString();
  const plan = DiversificationPlan.parse({
    plan_id: `DIV-${signalId}-${inputHash.slice(0, 12)}`,
    signal_id: signalId,
    client_id: signal.client_id,
    as_of: context.envelope.asOf,
    horizon_months: 36,
    currency: "USD",
    baseline_value_usd: context.envelope.baselineValueUsd,
    assumption_set_version: ASSUMPTION_SET_VERSION,
    context_pack_hash: context.contextPackHash,
    source_refs: context.sourceRefs,
    assumptions: assumptionDisclosures(),
    baseline_projections: baselineProjections,
    actions,
    caveats: [
      "These are assumption-driven illustrations, not forecasts or recommendations to execute.",
      "Only four historical return observations are available, so no historical covariance matrix was fitted.",
      "Structured-product and alternative payoff shapes are approximated at asset-class level.",
      "Portfolio sleeves are rebalanced quarterly to each action's target mix, with common random market paths used across all comparisons.",
      ...context.envelope.warnings,
    ],
    confidence,
    generated_at: generatedAt,
  });
  await repository.saveDiversificationPlan(plan, inputHash);
  await onProgress({ stage: "complete", message: "Diversification analysis complete", payload: plan });
  return plan;
}
