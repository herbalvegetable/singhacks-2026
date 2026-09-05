import { z } from "zod";
import { SourceRef } from "./signal";

export const DecisionTargetType = z.enum([
  "narrative_recommendation",
  "diversification_action",
]);

export const RejectReasonCode = z.enum([
  "not_applicable",
  "client_already_aware",
  "needs_compliance_review",
  "insufficient_evidence",
  "client_preference",
  "suitability_concern",
  "mandate_conflict",
  "data_quality_concern",
  "timing_not_appropriate",
  "other",
]);

const DecisionTarget = z
  .object({
    client_id: z.string().trim().min(1),
    target_type: DecisionTargetType,
    target_id: z.string().trim().min(1),
  })
  .strict();

export const AcceptDecision = DecisionTarget.extend({
  action: z.literal("accept"),
}).strict();

export const ModifyDecision = DecisionTarget.extend({
  action: z.literal("modify"),
  instructions: z.string().trim().min(1, "Modification instructions are required"),
}).strict();

export const RejectDecision = DecisionTarget.extend({
  action: z.literal("reject"),
  reason_code: RejectReasonCode,
  reason_text: z.string().trim().optional(),
})
  .strict()
  .superRefine((decision, context) => {
    if (decision.reason_code === "other" && !decision.reason_text) {
      context.addIssue({
        code: "custom",
        path: ["reason_text"],
        message: "Reason text is required when the reason code is other",
      });
    }
  });

export const DecisionRequest = z.union([
  AcceptDecision,
  ModifyDecision,
  RejectDecision,
]);

export const DecisionLookup = DecisionTarget;

export const AuditEntry = z.object({
  entry_id: z.string(),
  ts: z.string(),
  rm_id: z.string(),
  action: z.enum(["accept", "modify", "reject"]),
  target_type: DecisionTargetType,
  target_id: z.string(),
  client_id: z.string(),
  before: z.unknown(),
  after: z.unknown().nullable(),
  reason_code: RejectReasonCode.nullable(),
  reason_text: z.string().nullable(),
  confidence_at_decision: z.number().int().min(0).max(100),
  prompt_version: z.string(),
  model: z.string(),
  input_hash: z.string(),
  context_pack_hash: z.string().nullable(),
  source_refs: z.array(SourceRef),
  prev_hash: z.string().length(64),
  hash: z.string().length(64),
});

export type DecisionTargetType = z.infer<typeof DecisionTargetType>;
export type RejectReasonCode = z.infer<typeof RejectReasonCode>;
export type DecisionRequest = z.infer<typeof DecisionRequest>;
export type DecisionLookup = z.infer<typeof DecisionLookup>;
export type AuditEntry = z.infer<typeof AuditEntry>;

export interface AppendAuditEntryInput {
  rm_id: string;
  action: AuditEntry["action"];
  target_type: DecisionTargetType;
  target_id: string;
  client_id: string;
  before: unknown;
  after: unknown | null;
  reason_code: RejectReasonCode | null;
  reason_text: string | null;
  confidence_at_decision: number;
  prompt_version: string;
  model: string;
  input_hash: string;
  context_pack_hash: string | null;
  source_refs: z.infer<typeof SourceRef>[];
}
