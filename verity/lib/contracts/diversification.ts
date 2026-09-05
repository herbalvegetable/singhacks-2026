import { z } from "zod";
import { SourceRef } from "./signal";

export const AssetClass = z.enum([
  "Cash and Equivalents",
  "Fixed Income",
  "Equity",
  "Alternatives",
  "Commodities",
  "Structured Products",
]);

export const TradeInstruction = z.object({
  portfolio_id: z.string(),
  instrument_id: z.string(),
  instrument_name: z.string(),
  direction: z.enum(["buy", "sell"]),
  usd_amount: z.number().positive(),
  rationale: z.string(),
});

export const TargetAllocation = z.object({
  asset_class: AssetClass,
  current_pct: z.number(),
  target_pct: z.number(),
  delta_pct: z.number(),
});

export const ProposedAction = z.object({
  action_id: z.string(),
  title: z.string(),
  thesis: z.string(),
  objective_alignment: z.array(z.string()).min(1),
  trades: z.array(TradeInstruction),
  target_allocations: z.array(TargetAllocation).length(6),
  caveats: z.array(z.string()),
});

export const ActionProposal = z.object({
  actions: z.array(ProposedAction).length(3),
});

export const ProjectionPoint = z.object({
  month: z.number().int().min(0),
  p10_value: z.number().nonnegative(),
  p50_value: z.number().nonnegative(),
  p90_value: z.number().nonnegative(),
  cumulative_return_pct: z.number(),
});

export const ScenarioProjection = z.object({
  scenario_id: z.string(),
  scenario_name: z.string(),
  action_id: z.string(),
  points: z.array(ProjectionPoint).min(2),
  terminal_p10: z.number().nonnegative(),
  terminal_p50: z.number().nonnegative(),
  terminal_p90: z.number().nonnegative(),
  expected_return_pct: z.number(),
  annualized_return_pct: z.number(),
  annualized_volatility_pct: z.number().nonnegative(),
  sharpe_ratio: z.number(),
  value_at_risk_95_usd: z.number().nonnegative(),
  conditional_var_95_usd: z.number().nonnegative(),
  max_drawdown_pct: z.number(),
  probability_of_loss_pct: z.number().min(0).max(100),
});

export const RiskAssessment = z.object({
  score: z.number().int().min(0).max(100),
  profile: z.enum(["Low", "Moderate", "Elevated", "High"]),
  annualized_volatility_pct: z.number().nonnegative(),
  concentration_score: z.number().min(0).max(100),
  liquidity_score: z.number().min(0).max(100),
  mandate_distance_score: z.number().min(0).max(100),
  suitable_for_client: z.boolean(),
  mandate_compliant: z.boolean(),
  reasons: z.array(z.string()),
  suitability: z.object({
    status: z.enum(["suitable", "review_required"]),
    risk_profile: z.string(),
    risk_tolerance_score: z.number(),
    risk_score: z.number(),
    tolerance_ceiling: z.number(),
    risk_gate_passed: z.boolean(),
    mandate_gate_passed: z.boolean(),
    statement: z.string(),
  }).optional(),
  mandate_checks: z.array(z.object({
    portfolio_id: z.string(),
    portfolio_name: z.string(),
    mandate_code: z.string(),
    mandate_name: z.string(),
    asset_class: AssetClass,
    min_pct: z.number(),
    max_pct: z.number(),
    current_pct: z.number(),
    compliant: z.boolean(),
    reason: z.string(),
  })).optional(),
});

export const ActionSummary = z.object({
  action_id: z.string(),
  summary: z.string(),
  trade_offs: z.array(z.string()),
  rm_talking_points: z.array(z.string()),
  confidence: z.number().int().min(0).max(100),
});

export const AssumptionDisclosure = z.object({
  asset_class: AssetClass,
  expected_return_pct: z.number(),
  volatility_pct: z.number().nonnegative(),
  rationale: z.string(),
});

export const DiversificationActionResult = z.object({
  action: ProposedAction,
  risk: RiskAssessment,
  projections: z.array(ScenarioProjection).length(4),
  summary: ActionSummary,
});

export const DiversificationPlan = z.object({
  plan_id: z.string(),
  signal_id: z.string(),
  client_id: z.string(),
  as_of: z.string(),
  horizon_months: z.number().int().positive(),
  currency: z.literal("USD"),
  baseline_value_usd: z.number().positive(),
  assumption_set_version: z.string(),
  context_pack_hash: z.string(),
  source_refs: z.array(SourceRef),
  assumptions: z.array(AssumptionDisclosure).length(6),
  baseline_projections: z.array(ScenarioProjection).length(4),
  actions: z.array(DiversificationActionResult).length(3),
  caveats: z.array(z.string()),
  confidence: z.number().int().min(0).max(100),
  generated_at: z.string(),
});

export type AssetClass = z.infer<typeof AssetClass>;
export type TradeInstruction = z.infer<typeof TradeInstruction>;
export type TargetAllocation = z.infer<typeof TargetAllocation>;
export type ProposedAction = z.infer<typeof ProposedAction>;
export type ActionProposal = z.infer<typeof ActionProposal>;
export type ProjectionPoint = z.infer<typeof ProjectionPoint>;
export type ScenarioProjection = z.infer<typeof ScenarioProjection>;
export type RiskAssessment = z.infer<typeof RiskAssessment>;
export type ActionSummary = z.infer<typeof ActionSummary>;
export type AssumptionDisclosure = z.infer<typeof AssumptionDisclosure>;
export type DiversificationActionResult = z.infer<typeof DiversificationActionResult>;
export type DiversificationPlan = z.infer<typeof DiversificationPlan>;
