import {
  buildBookRiskFacts,
  generateBookRiskPriorities,
  hashBookRiskFacts,
} from "@/lib/agents/priorityAgent";
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

export async function GET() {
  try {
    const session = await requireApiSession();
    const priorities = await new Repository().getLatestRiskPrioritiesForRm(
      session.rmId,
    );
    return Response.json({ priorities });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Unable to load priorities", error);
  }
}

export async function POST(request: NextRequest) {
  let releaseConcurrency: (() => Promise<void>) | undefined;
  const releaseLease = async () => {
    const release = releaseConcurrency;
    releaseConcurrency = undefined;
    if (!release) return;
    try {
      await release();
    } catch (error) {
      console.error("Unable to release priorities concurrency lease:", error);
    }
  };
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    await enforceRateLimit(request, {
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
    releaseConcurrency = await acquireConcurrency(`priorities:${session.rmId}`, 1);
    await reserveDailyAiBudget(session.rmId, 24_000);
    const repository = new Repository();
    const facts = await buildBookRiskFacts(repository, session.rmId);
    const inputHash = hashBookRiskFacts(facts);
    const cached = await repository.getLatestRiskPrioritiesForRm(session.rmId);
    if (
      cached.length === facts.length &&
      cached.every((priority) => priority.input_hash === inputHash)
    ) {
      return Response.json({ priorities: cached, generated: false });
    }

    const { priorities } = await generateBookRiskPriorities(repository, facts);
    await repository.saveRiskPriorities(priorities);
    await writeSecurityAuditEvent({
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
    await releaseLease();
  }
}
