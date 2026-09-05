import type { AssetClass, RiskAssessment } from "../../contracts/diversification";
import {
  formatSuitabilityStatement,
  type MandateCheck,
} from "../suitability";
import {
  ASSET_CLASSES,
  CAPITAL_MARKET_ASSUMPTIONS,
  CORRELATION_MATRIX,
} from "./assumptions";
import { normalizeWeights, type AllocationWeights } from "./monteCarlo";

export interface RiskScoreInput {
  allocations: Partial<Record<AssetClass, number>>;
  positionWeights: number[];
  liquidityTiers: Array<{ weight: number; tier: string }>;
  mandateChecks: MandateCheck[];
  riskToleranceScore: number;
  riskProfile: string;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function portfolioVolatility(weights: AllocationWeights): number {
  let variance = 0;
  for (let row = 0; row < ASSET_CLASSES.length; row += 1) {
    for (let column = 0; column < ASSET_CLASSES.length; column += 1) {
      const leftClass = ASSET_CLASSES[row];
      const rightClass = ASSET_CLASSES[column];
      variance +=
        weights[leftClass] *
        weights[rightClass] *
        CAPITAL_MARKET_ASSUMPTIONS[leftClass].volatility *
        CAPITAL_MARKET_ASSUMPTIONS[rightClass].volatility *
        CORRELATION_MATRIX[row][column];
    }
  }
  return Math.sqrt(Math.max(0, variance));
}

export function assessPortfolioRisk(input: RiskScoreInput): RiskAssessment {
  const weights = normalizeWeights(input.allocations);
  const volatility = portfolioVolatility(weights);
  const normalizedPositions = input.positionWeights.map((weight) => weight > 1 ? weight / 100 : weight);
  const hhi = normalizedPositions.reduce((sum, weight) => sum + weight ** 2, 0);
  const concentrationScore = clamp(Math.sqrt(hhi) * 100);

  const illiquidityFactors: Record<string, number> = {
    Daily: 0,
    Weekly: 15,
    Monthly: 35,
    Quarterly: 70,
    Illiquid: 100,
  };
  const liquidityScore = clamp(
    input.liquidityTiers.reduce(
      (sum, item) =>
        sum +
        (item.weight > 1 ? item.weight / 100 : item.weight) *
          (illiquidityFactors[item.tier] ?? 50),
      0,
    ),
  );

  const totalDistance = input.mandateChecks.reduce(
    (sum, check) =>
      sum +
      Math.max(
        check.min_pct - check.current_pct,
        check.current_pct - check.max_pct,
        0,
      ),
    0,
  );
  const compliant = input.mandateChecks.every((check) => check.compliant);
  const mandateDistanceScore = clamp(totalDistance / 1.5);
  const score = Math.round(
    clamp(volatility * 300 + concentrationScore * 0.3 + liquidityScore * 0.15 + mandateDistanceScore * 0.1),
  );
  const toleranceCeiling = clamp(input.riskToleranceScore * 10 + 10);
  const riskGatePassed = score <= toleranceCeiling;
  const suitable = riskGatePassed && compliant;
  const profile =
    score < 30 ? "Low" : score < 50 ? "Moderate" : score < 70 ? "Elevated" : "High";

  const reasons = [
    `Assumption-based annualized volatility is ${(volatility * 100).toFixed(1)}%.`,
    `Largest-position concentration contributes to a ${concentrationScore.toFixed(0)}/100 concentration score.`,
    compliant ? "Allocation remains inside applicable mandate bands." : "One or more mandate bands are breached.",
    suitable
      ? `Risk score passes the numeric gate for tolerance ${input.riskToleranceScore}/10.`
      : `The numeric risk gate or a managed-portfolio mandate check does not pass.`,
    ...input.mandateChecks.map((check) => check.reason),
  ];

  return {
    score,
    profile,
    annualized_volatility_pct: Number((volatility * 100).toFixed(2)),
    concentration_score: Number(concentrationScore.toFixed(2)),
    liquidity_score: Number(liquidityScore.toFixed(2)),
    mandate_distance_score: Number(mandateDistanceScore.toFixed(2)),
    suitable_for_client: suitable,
    mandate_compliant: compliant,
    reasons,
    mandate_checks: input.mandateChecks,
    suitability: {
      status: suitable ? "suitable" : "review_required",
      risk_profile: input.riskProfile,
      risk_tolerance_score: input.riskToleranceScore,
      risk_score: score,
      tolerance_ceiling: toleranceCeiling,
      risk_gate_passed: riskGatePassed,
      mandate_gate_passed: compliant,
      statement: formatSuitabilityStatement({
        riskProfile: input.riskProfile,
        riskToleranceScore: input.riskToleranceScore,
        riskScore: score,
        toleranceCeiling,
        riskGatePassed,
        mandateGatePassed: compliant,
      }),
    },
  };
}
