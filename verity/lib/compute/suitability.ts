import type { AssetClass, RiskAssessment } from "../contracts/diversification";

export type MandateCheck = NonNullable<RiskAssessment["mandate_checks"]>[number];

export function formatSuitabilityStatement(input: {
  riskProfile: string;
  riskToleranceScore: number;
  riskScore: number;
  toleranceCeiling: number;
  riskGatePassed: boolean;
  mandateGatePassed: boolean;
}): string {
  const riskResult = input.riskGatePassed
    ? `the computed risk score ${input.riskScore}/100 is within the numeric tolerance ceiling ${input.toleranceCeiling}/100`
    : `the computed risk score ${input.riskScore}/100 exceeds the numeric tolerance ceiling ${input.toleranceCeiling}/100`;
  const mandateResult = input.mandateGatePassed
    ? "all tested managed-portfolio allocation bands pass"
    : "one or more tested managed-portfolio allocation bands fail";
  return `Risk profile: ${input.riskProfile}. Using risk tolerance ${input.riskToleranceScore}/10 as the numeric gate, ${riskResult}; ${mandateResult}.`;
}

export function formatMandateCheckReason(input: {
  mandateName: string;
  assetClass: AssetClass;
  currentPct: number;
  minPct: number;
  maxPct: number;
}): string {
  const range = `${input.minPct.toFixed(2)}%–${input.maxPct.toFixed(2)}%`;
  if (input.currentPct < input.minPct - 0.01) {
    return `${input.mandateName}: ${input.assetClass} is ${input.currentPct.toFixed(2)}%, below the ${range} band.`;
  }
  if (input.currentPct > input.maxPct + 0.01) {
    return `${input.mandateName}: ${input.assetClass} is ${input.currentPct.toFixed(2)}%, above the ${range} band.`;
  }
  return `${input.mandateName}: ${input.assetClass} is ${input.currentPct.toFixed(2)}%, within the ${range} band.`;
}

export type NarrativeSuitabilityStatus =
  | "discussion_only"
  | "no_portfolio_change"
  | "requires_quantified_analysis";

export function assessNarrativeSuitability(
  recommendation: { title: string; rationale: string; steps: string[] } | null,
): { status: NarrativeSuitabilityStatus; statement: string } {
  if (!recommendation) {
    return {
      status: "no_portfolio_change",
      statement:
        "No portfolio change is proposed, so quantified mandate and risk-tolerance compliance is not claimed.",
    };
  }
  const text = [
    recommendation.title,
    recommendation.rationale,
    ...recommendation.steps,
  ].join(" ");
  const impliesPortfolioChange =
    /\b(buy|sell|trade|rebalance|allocate|allocation|increase|decrease|reduce|add|trim|switch|redeem|invest|exposure|position|holding)\b/i.test(
      text,
    );
  return impliesPortfolioChange
    ? {
        status: "requires_quantified_analysis",
        statement:
          "Mandate fit and risk-tolerance suitability require the quantified diversification analysis before any portfolio change is considered.",
      }
    : {
        status: "discussion_only",
        statement:
          "This is a discussion-only recommendation with no quantified mandate-compliance claim.",
      };
}
