import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  attachNarrativeSuitability,
  NarrativeAgent,
  NARRATIVE_PROMPT_VERSION,
} from "@/lib/agents/narrativeAgent";
import { stripInternalReferenceTagsDeep } from "@/lib/agents/outputSanitizer";
import { Repository } from "@/lib/db/repository";
import { requireApiSession } from "@/lib/security/auth";
import { requireSignalAccess } from "@/lib/security/access";
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

interface NarrativeClientContext {
  client_id: string;
  client_name: string;
  age: number | null;
  risk_profile: string;
  objectives: string;
  life_stage: string;
  total_aum_usd: number;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ signalId: string }> }
) {
  let releaseConcurrency: (() => Promise<void>) | undefined;
  const releaseLease = async () => {
    const release = releaseConcurrency;
    releaseConcurrency = undefined;
    if (!release) return;
    try {
      await release();
    } catch (error) {
      console.error("Unable to release narrative concurrency lease:", error);
    }
  };
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    await enforceRateLimit(request, {
      bucket: "narrative",
      limit: 10,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    releaseConcurrency = await acquireConcurrency(`narrative:${session.rmId}`, 2);
    await reserveDailyAiBudget(session.rmId, 3_000);
    const { signalId } = await context.params;
    const repository = new Repository();
    await requireSignalAccess(repository, session.rmId, signalId);

    const signal = await repository.getSignal(signalId);
    if (!signal) {
      return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    }

    const client = (await repository.getClient(
      signal.client_id,
    )) as NarrativeClientContext | undefined;
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          prompt_version: NARRATIVE_PROMPT_VERSION,
          signal,
          client,
        }),
      )
      .digest("hex");

    const cached = await repository.getNarrativeRow(signal.client_id);

    if (cached) {
      if (
        cached.payload[signalId] &&
        cached.input_hash[signalId] === inputHash
      ) {
        return NextResponse.json(
          stripInternalReferenceTagsDeep(
            attachNarrativeSuitability(cached.payload[signalId]),
          ),
        );
      }
    }

    // Generate narrative
    const agent = new NarrativeAgent();
    const narrative = await agent.generateNarrative(signal, client);
    await writeSecurityAuditEvent({
      rmId: session.rmId,
      eventType: "model_response",
      target: "narrative",
      clientId: signal.client_id,
      metadata: {
        model: "gpt-4o",
        prompt_version: NARRATIVE_PROMPT_VERSION,
        input_hash: inputHash,
        estimated_tokens_reserved: 3_000,
      },
    });

    // Cache it
    const allNarratives = { ...(cached?.payload ?? {}) };
    allNarratives[signalId] = narrative;
    const allInputHashes = { ...(cached?.input_hash ?? {}) };
    allInputHashes[signalId] = inputHash;

    await repository.saveNarrativeRow(
      signal.client_id,
      allNarratives,
      allInputHashes,
    );

    return NextResponse.json(stripInternalReferenceTagsDeep(narrative));
  } catch (error: unknown) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Failed to generate narrative", error);
  } finally {
    await releaseLease();
  }
}
