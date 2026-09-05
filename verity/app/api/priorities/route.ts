import {
  buildBookRiskFacts,
  generateBookRiskPriorities,
  hashBookRiskFacts,
} from "@/lib/agents/priorityAgent";
import type { StoredRiskPriority } from "@/lib/contracts/priority";
import { Repository } from "@/lib/db/repository";
import { NextRequest } from "next/server";
import { requireApiSession } from "@/lib/security/auth";
import {
  assertSameOrigin,
  internalErrorResponse,
  securityErrorResponse,
} from "@/lib/security/http";
import {
  acquireConcurrency,
  enforceRateLimit,
  reserveDailyAiBudget,
} from "@/lib/security/abuse";
import { writeSecurityAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const activeGenerations = new Map<string, Promise<StoredRiskPriority[]>>();

export async function GET() {
  try {
    const session = await requireApiSession();
    const priorities = new Repository().getLatestRiskPrioritiesForRm(session.rmId);
    return Response.json({ priorities });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Unable to load priorities", error);
  }
}

export async function POST(request: NextRequest) {
  let releaseConcurrency: (() => void) | undefined;
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    enforceRateLimit(request, {
      bucket: "priorities",
      limit: 2,
      windowMs: 60 * 60_000,
      rmId: session.rmId,
    });
    const admins = new Set(
      (process.env.VERITY_PRIORITY_ADMIN_RM_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (!admins.has(session.rmId)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    reserveDailyAiBudget(session.rmId, 24_000);
    releaseConcurrency = acquireConcurrency(`priorities:${session.rmId}`, 1);
    const repository = new Repository();
    const facts = buildBookRiskFacts(repository, session.rmId);
    const inputHash = hashBookRiskFacts(facts);
    const cached = repository.getLatestRiskPrioritiesForRm(session.rmId);
    if (
      cached.length === facts.length &&
      cached.every((priority) => priority.input_hash === inputHash)
    ) {
      return Response.json({ priorities: cached, generated: false });
    }

    let activeGeneration = activeGenerations.get(session.rmId);
    if (!activeGeneration) {
      activeGeneration = generateBookRiskPriorities(
        repository,
        facts,
      )
        .then(({ priorities }) => {
          repository.saveRiskPriorities(priorities);
          return priorities;
        })
        .finally(() => {
          activeGenerations.delete(session.rmId);
        });
      activeGenerations.set(session.rmId, activeGeneration);
    }
    const priorities = await activeGeneration;
    writeSecurityAuditEvent({
      rmId: session.rmId,
      eventType: "model_response",
      target: "risk_priorities",
      metadata: {
        model: "gpt-4o",
        prompt_version: "risk-priority-v1",
        estimated_tokens_reserved: 24_000,
        priority_count: priorities.length,
      },
    });
    return Response.json({ priorities, generated: true });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Unable to generate risk priorities", error);
  } finally {
    releaseConcurrency?.();
  }
}
