import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type {
  ActionSummary,
  ProposedAction,
  RiskAssessment,
  ScenarioProjection,
} from "../../contracts/diversification";
import { stripInternalReferenceTagsDeep } from "../outputSanitizer";
import {
  OPENAI_REQUEST_OPTIONS,
  requireAgentsEnabled,
} from "../runtime";
import { numbersAreTraceable } from "../outputGuard";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "agents-disabled",
  ...OPENAI_REQUEST_OPTIONS,
});

const SummaryPayload = z.object({
  summary: z.string().max(2500),
  trade_offs: z.array(z.string().max(500)).min(2).max(4),
  rm_talking_points: z.array(z.string().max(500)).min(2).max(4),
  confidence: z.number().int().min(0).max(100),
});

export async function summarizeDiversificationAction(input: {
  clientObjectives: string;
  action: ProposedAction;
  risk: RiskAssessment;
  projections: ScenarioProjection[];
  confidenceCeiling: number;
}): Promise<ActionSummary> {
  requireAgentsEnabled();
  const completion = await openai.chat.completions.parse({
    model: "gpt-4o",
    temperature: 0.2,
    response_format: zodResponseFormat(SummaryPayload, "action_summary"),
    messages: [
      {
        role: "system",
        content: `You are Verity's portfolio scenario narrator. Explain one proposed action to a Relationship Manager.
All numbers were calculated by a deterministic engine. Repeat them exactly; never calculate, infer or alter a number.
Clearly call projections assumption-driven estimates, not forecasts. Connect the action to the stated objectives.
Discuss both benefit and downside. Do not advise execution. Confidence cannot exceed ${input.confidenceCeiling}.
Never include internal record IDs or reference tags such as [narrative:...], [signal:...], or [diversification:...] in output text.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            client_objectives: input.clientObjectives,
            proposed_action: input.action,
            deterministic_risk_assessment: input.risk,
            deterministic_scenario_projections: input.projections.map((projection) => ({
              scenario: projection.scenario_name,
              terminal_p10: projection.terminal_p10,
              terminal_p50: projection.terminal_p50,
              terminal_p90: projection.terminal_p90,
              expected_return_pct: projection.expected_return_pct,
              annualized_return_pct: projection.annualized_return_pct,
              annualized_volatility_pct: projection.annualized_volatility_pct,
              sharpe_ratio: projection.sharpe_ratio,
              value_at_risk_95_usd: projection.value_at_risk_95_usd,
              conditional_var_95_usd: projection.conditional_var_95_usd,
              max_drawdown_pct: projection.max_drawdown_pct,
              probability_of_loss_pct: projection.probability_of_loss_pct,
            })),
          },
          null,
          2,
        ),
      },
    ],
    max_completion_tokens: 900,
  });
  const parsed = completion.choices[0].message.parsed;
  if (!parsed) throw new Error(`Failed to parse summary for ${input.action.action_id}`);
  if (
    !numbersAreTraceable(
      [
        parsed.summary,
        ...parsed.trade_offs,
        ...parsed.rm_talking_points,
      ].join("\n"),
      input,
    )
  ) {
    throw new Error(`Untraceable number in summary for ${input.action.action_id}`);
  }
  return stripInternalReferenceTagsDeep({
    action_id: input.action.action_id,
    summary: parsed.summary,
    trade_offs: parsed.trade_offs,
    rm_talking_points: parsed.rm_talking_points,
    confidence: Math.min(input.confidenceCeiling, parsed.confidence),
  });
}

export function fallbackActionSummary(input: {
  action: ProposedAction;
  risk: RiskAssessment;
  projections: ScenarioProjection[];
  confidenceCeiling: number;
}): ActionSummary {
  const central =
    input.projections.find(
      (projection) => projection.scenario_id === "central",
    ) ?? input.projections[0];
  const tradeDescription =
    input.action.trades.length > 0
      ? `${input.action.trades.length} constraint-checked hypothetical trades`
      : "a constraint-aware hold and RM review";
  return {
    action_id: input.action.action_id,
    summary: `${input.action.title} uses ${tradeDescription}. The deterministic model assigns a ${input.risk.profile.toLowerCase()} risk profile (${input.risk.score}/100) and a Central scenario median terminal value of USD ${central.terminal_p50.toLocaleString("en-US")}.`,
    trade_offs: [
      input.risk.mandate_compliant
        ? "The resulting allocation remains inside the applicable mandate bands."
        : "The allocation requires mandate review before any implementation.",
      "Scenario results are assumption-driven estimates rather than forecasts.",
    ],
    rm_talking_points: [
      input.action.thesis,
      input.action.trades.length > 0
        ? "Confirm suitability, tax impact and execution details before acting."
        : "Review which constraint must change before proposing an executable rebalance.",
    ],
    confidence: Math.min(input.confidenceCeiling, 55),
  };
}
