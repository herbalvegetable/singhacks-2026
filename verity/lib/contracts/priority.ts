import { z } from "zod";

export const RiskSummary = z.object({
  client_id: z.string(),
  summary: z.string(),
  key_risks: z.array(z.string()).min(1).max(5),
  evidence_ref_ids: z.array(z.string()).min(1),
  uncertainty: z.string().nullable(),
});

export const RiskSummaryBatch = z.object({
  summaries: z.array(RiskSummary),
});

export const RiskDimensionName = z.enum([
  "signal_severity",
  "liquidity_deadlines",
  "concentration",
  "credit_margin",
  "data_uncertainty",
]);

export const RiskDimensionAssessment = z.object({
  dimension: RiskDimensionName,
  severity: z.enum(["low", "moderate", "high", "critical"]),
  rationale: z.string(),
});

export const RiskPriorityAssessment = z.object({
  client_id: z.string(),
  risk_score: z.number().int().min(1).max(100),
  attention_band: z.enum(["call_today", "this_week", "monitor"]),
  rationale: z.string(),
  dimensions: z.array(RiskDimensionAssessment).length(5),
  evidence_ref_ids: z.array(z.string()).min(1),
  confidence: z.number().int().min(0).max(100),
});

export const RiskPriorityBatch = z.object({
  assessments: z.array(RiskPriorityAssessment),
});

export const StoredRiskPriority = RiskPriorityAssessment.extend({
  rank: z.number().int().positive(),
  risk_summary: z.string(),
  key_risks: z.array(z.string()),
  uncertainty: z.string().nullable(),
  input_hash: z.string(),
  generated_at: z.string(),
});

export type RiskSummary = z.infer<typeof RiskSummary>;
export type RiskPriorityAssessment = z.infer<typeof RiskPriorityAssessment>;
export type StoredRiskPriority = z.infer<typeof StoredRiskPriority>;
