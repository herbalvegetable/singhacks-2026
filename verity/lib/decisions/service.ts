import { createHash } from "crypto";
import { z } from "zod";
import type {
  AppendAuditEntryInput,
  DecisionRequest,
  DecisionTargetType,
} from "../contracts/decision";
import type { SourceRef } from "../contracts/signal";
import { canonicalJson, Repository } from "../db/repository";

const NarrativeArtifact = z.object({
  recommended_action: z
    .object({
      title: z.string(),
      rationale: z.string(),
      steps: z.array(z.string()),
      confidence: z.number().int().min(0).max(100),
    })
    .nullable(),
  confidence: z.number().min(0).max(100),
});

export class DecisionTargetError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404,
  ) {
    super(message);
  }
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function uniqueSourceRefs(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = canonicalJson(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertOwner(actualClientId: string, claimedClientId: string): void {
  if (actualClientId !== claimedClientId) {
    throw new DecisionTargetError(
      "The decision target does not belong to the specified client",
      403,
    );
  }
}

export interface ResolvedDecisionTarget {
  target_type: DecisionTargetType;
  target_id: string;
  client_id: string;
  before: unknown;
  confidence: number;
  prompt_version: string;
  model: string;
  input_hash: string;
  context_pack_hash: string | null;
  source_refs: SourceRef[];
}

export function resolveDecisionTarget(
  repository: Repository,
  targetType: DecisionTargetType,
  targetId: string,
  claimedClientId: string,
): ResolvedDecisionTarget {
  if (targetType === "narrative_recommendation") {
    const signal = repository.getSignal(targetId);
    if (!signal) throw new DecisionTargetError("Signal not found", 404);
    assertOwner(signal.client_id, claimedClientId);

    const stored = repository.getNarrativeArtifact(signal.client_id, targetId);
    if (!stored) throw new DecisionTargetError("Narrative not found", 404);
    const narrative = NarrativeArtifact.parse(stored.narrative);
    if (!narrative.recommended_action) {
      throw new DecisionTargetError(
        "This narrative has no recommendation to decide",
        400,
      );
    }
    const grounding = repository.getGrounding(targetId);
    return {
      target_type: targetType,
      target_id: targetId,
      client_id: signal.client_id,
      before: narrative.recommended_action,
      confidence: narrative.recommended_action.confidence,
      prompt_version: "narrative-recommendation-v1",
      model: "gpt-4o",
      input_hash:
        stored.input_hash ||
        sha256({ signal, narrative: stored.narrative, grounding }),
      context_pack_hash: null,
      source_refs: uniqueSourceRefs([
        ...signal.evidence,
        ...(grounding?.source_refs ?? []),
      ]),
    };
  }

  const separator = targetId.lastIndexOf(":");
  if (separator <= 0 || separator === targetId.length - 1) {
    throw new DecisionTargetError(
      "Diversification target must be formatted as plan_id:action_id",
      400,
    );
  }
  const planId = targetId.slice(0, separator);
  const actionId = targetId.slice(separator + 1);
  const stored = repository.getDiversificationPlanById(planId);
  if (!stored) throw new DecisionTargetError("Diversification plan not found", 404);
  assertOwner(stored.plan.client_id, claimedClientId);
  const action = stored.plan.actions.find(
    (candidate) => candidate.action.action_id === actionId,
  );
  if (!action) {
    throw new DecisionTargetError("Diversification action not found", 404);
  }
  return {
    target_type: targetType,
    target_id: targetId,
    client_id: stored.plan.client_id,
    before: action,
    confidence: action.summary.confidence,
    prompt_version: "diversification-action-and-summary-v1",
    model: "gpt-4o",
    input_hash: stored.input_hash || sha256(stored.plan),
    context_pack_hash: stored.plan.context_pack_hash,
    source_refs: uniqueSourceRefs(stored.plan.source_refs),
  };
}

export function buildAuditEntryInput(
  decision: DecisionRequest,
  target: ResolvedDecisionTarget,
  rmId: string,
): AppendAuditEntryInput {
  return {
    rm_id: rmId,
    action: decision.action,
    target_type: target.target_type,
    target_id: target.target_id,
    client_id: target.client_id,
    before: target.before,
    after:
      decision.action === "modify"
        ? { instructions: decision.instructions }
        : null,
    reason_code:
      decision.action === "reject" ? decision.reason_code : null,
    reason_text:
      decision.action === "reject" ? decision.reason_text ?? null : null,
    confidence_at_decision: Math.round(target.confidence),
    prompt_version: target.prompt_version,
    model: target.model,
    input_hash: target.input_hash,
    context_pack_hash: target.context_pack_hash,
    source_refs: target.source_refs,
  };
}
