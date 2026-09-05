import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getDb } from "@/lib/db/client";
import {
  attachNarrativeSuitability,
  NarrativeAgent,
  NARRATIVE_PROMPT_VERSION,
} from "@/lib/agents/narrativeAgent";
import { stripInternalReferenceTagsDeep } from "@/lib/agents/outputSanitizer";
import type { Signal } from "@/lib/contracts/signal";
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
  let releaseConcurrency: (() => void) | undefined;
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    enforceRateLimit(request, {
      bucket: "narrative",
      limit: 10,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    reserveDailyAiBudget(session.rmId, 3_000);
    releaseConcurrency = acquireConcurrency(`narrative:${session.rmId}`, 2);
    const { signalId } = await context.params;
    requireSignalAccess(new Repository(), session.rmId, signalId);
    const db = getDb();

    // Get signal
    const signalRow = db
      .prepare("SELECT payload, client_id FROM signals WHERE signal_id = ?")
      .get(signalId) as { payload: string; client_id: string } | undefined;

    if (!signalRow) {
      return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    }

    const signal: Signal = JSON.parse(signalRow.payload);

    // Get client context
    const client = db
      .prepare("SELECT * FROM clients WHERE client_id = ?")
      .get(signal.client_id) as NarrativeClientContext | undefined;
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

    // Check if we already have a narrative cached
    const cached = db
      .prepare("SELECT payload, input_hash FROM narratives WHERE client_id = ?")
      .get(signal.client_id) as
      | { payload: string; input_hash: string | null }
      | undefined;

    if (cached) {
      const narratives = JSON.parse(cached.payload);
      let inputHashes: Record<string, string> = {};
      try {
        inputHashes = JSON.parse(cached.input_hash ?? "{}");
      } catch {
        inputHashes = {};
      }
      if (narratives[signalId] && inputHashes[signalId] === inputHash) {
        return NextResponse.json(
          stripInternalReferenceTagsDeep(
            attachNarrativeSuitability(narratives[signalId]),
          ),
        );
      }
    }

    // Generate narrative
    const agent = new NarrativeAgent();
    const narrative = await agent.generateNarrative(signal, client);
    writeSecurityAuditEvent({
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
    const allNarratives = cached ? JSON.parse(cached.payload) : {};
    allNarratives[signalId] = narrative;
    let allInputHashes: Record<string, string> = {};
    try {
      allInputHashes = JSON.parse(cached?.input_hash ?? "{}");
    } catch {
      allInputHashes = {};
    }
    allInputHashes[signalId] = inputHash;

    db.prepare(
      "INSERT OR REPLACE INTO narratives (client_id, payload, input_hash) VALUES (?, ?, ?)"
    ).run(
      signal.client_id,
      JSON.stringify(allNarratives),
      JSON.stringify(allInputHashes),
    );

    return NextResponse.json(stripInternalReferenceTagsDeep(narrative));
  } catch (error: unknown) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Failed to generate narrative", error);
  } finally {
    releaseConcurrency?.();
  }
}
