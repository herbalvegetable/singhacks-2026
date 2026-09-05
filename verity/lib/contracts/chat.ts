import { z } from "zod";
import { SourceRef } from "./signal";

export const ChatRequest = z.object({
  client_id: z.string().regex(/^CL-\d{4}$/),
  query: z.string().trim().min(1).max(1200),
  conversation_id: z.string().uuid().optional(),
}).strict();

export const RetrievalIntent = z.enum([
  "portfolio",
  "signal",
  "risk",
  "liquidity",
  "mandate",
  "transaction",
  "facility",
  "source",
  "general",
]);

export const RetrievalPlan = z.object({
  intents: z.array(RetrievalIntent).min(1),
  terms: z.array(z.string()),
  needs_history: z.boolean(),
  needs_notes: z.boolean(),
});

export const RetrievedRecord = z.object({
  ref_id: z.string(),
  kind: z.string(),
  title: z.string(),
  text: z.string(),
  score: z.number(),
  source_refs: z.array(SourceRef),
  data: z.record(z.string(), z.unknown()),
});

export const ContextPack = z.object({
  client_id: z.string(),
  client_name: z.string(),
  as_of: z.string(),
  query: z.string(),
  retrieval_plan: RetrievalPlan,
  client_profile: z.record(z.string(), z.unknown()),
  records: z.array(RetrievedRecord),
  data_quality_flags: z.array(z.record(z.string(), z.unknown())),
  context_pack_hash: z.string(),
});

export const CopilotCitation = z.object({
  ref_id: z.string().max(180),
  label: z.string().max(180),
});

export const CopilotChartType = z.enum([
  "pie",
  "bar",
  "line",
  "histogram",
]);

export const CopilotChartPoint = z.object({
  label: z.string(),
  value: z.number(),
  source_ref_ids: z.array(z.string()),
});

export const CopilotChartSeries = z.object({
  name: z.string(),
  points: z.array(CopilotChartPoint).min(1),
});

export const CopilotChart = z.object({
  chart_id: z.string(),
  type: CopilotChartType,
  title: z.string(),
  subtitle: z.string().nullable(),
  x_label: z.string(),
  y_label: z.string(),
  unit: z.enum(["USD", "percent", "count", "score", "ratio"]),
  series: z.array(CopilotChartSeries).min(1).max(4),
  source_ref_ids: z.array(z.string()).min(1),
  decision_reason: z.string(),
});

export const CopilotAnswer = z.object({
  answer: z.string().min(1).max(5000),
  citations: z.array(CopilotCitation).max(20),
  confidence: z.number().int().min(0).max(100),
  caveat: z.string().max(1000).nullable(),
  refused: z.boolean(),
  follow_up_questions: z
    .array(z.string().min(1).max(110))
    .length(3),
});

export type ChatRequest = z.infer<typeof ChatRequest>;
export type RetrievalPlan = z.infer<typeof RetrievalPlan>;
export type RetrievedRecord = z.infer<typeof RetrievedRecord>;
export type ContextPack = z.infer<typeof ContextPack>;
export type CopilotAnswer = z.infer<typeof CopilotAnswer>;
export type CopilotChartType = z.infer<typeof CopilotChartType>;
export type CopilotChart = z.infer<typeof CopilotChart>;
