import { z } from "zod";

export const SourceRef = z.object({
  source: z.enum([
    "holdings.csv",
    "instruments.csv",
    "transactions.csv",
    "mandates.csv",
    "credit_facilities.csv",
    "commitments.csv",
    "planned_cash_needs.csv",
    "market_context.csv",
    "event_log.csv",
    "portfolios.csv",
    "clients.csv",
    "rm_notes.json",
  ]),
  key: z.record(z.string(), z.string()),
  fields: z.array(z.string()),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type SourceRef = z.infer<typeof SourceRef>;

export const GROUNDING_NO_MATCH_MESSAGE =
  "No clear causal link found in the event log.";

export const Grounding = z.object({
  signal_id: z.string(),
  explanation: z.string(),
  matched_event_ids: z.array(z.string()),
  candidate_event_ids: z.array(z.string()),
  confidence: z.number().int().min(0).max(100),
  no_match: z.boolean(),
  source_refs: z.array(SourceRef),
  model: z.literal("gpt-4o"),
  prompt_version: z.string(),
  generated_at: z.string(),
});

export type Grounding = z.infer<typeof Grounding>;

export const Signal = z.object({
  signal_id: z.string(),
  client_id: z.string(),
  portfolio_ids: z.array(z.string()),
  type: z.enum(["explanation", "risk", "opportunity", "liquidity", "governance"]),
  subtype: z.string(),
  headline: z.string(),
  window: z.object({ from: z.string(), to: z.string() }),
  magnitude_usd: z.number().nullable(),
  magnitude_pct: z.number().nullable(),
  direction: z.enum(["negative", "positive", "neutral"]),
  urgency_score: z.number().int().min(0).max(100),
  urgency_breakdown: z.record(z.string(), z.number()),
  affected_holdings: z.array(
    z.object({
      instrument_id: z.string(),
      instrument_name: z.string(),
      portfolio_id: z.string(),
      market_value_usd: z.number(),
      weight_pct: z.number(),
    })
  ),
  evidence: z.array(SourceRef).min(1),
  data_quality_flags: z.array(z.string()),
  computed_at: z.string(),
});

export type Signal = z.infer<typeof Signal>;

export const DataQualityFlag = z.object({
  flag_id: z.string(),
  severity: z.enum(["warning", "error"]),
  scope_type: z.enum(["client", "portfolio", "position", "facility"]),
  scope_id: z.string(),
  code: z.enum([
    "MISSING_COST_BASIS",
    "PRE_RELATIONSHIP_SNAPSHOT",
    "CASH_FLOWS_NOT_RECONCILED",
    "LAGGED_PRIVATE_MARK",
    "STALE_VALUATION",
    "UNEXPLAINED_QUANTITY_CHANGE",
  ]),
  description: z.string(),
  source_ref: z.string(),
});

export type DataQualityFlag = z.infer<typeof DataQualityFlag>;
