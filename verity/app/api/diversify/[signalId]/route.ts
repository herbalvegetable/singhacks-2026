import { NextRequest } from "next/server";
import {
  generateDiversificationPlan,
  type ProgressUpdate,
} from "@/lib/agents/diversification/orchestrator";
import { Repository } from "@/lib/db/repository";
import { requireApiSession } from "@/lib/security/auth";
import { requireSignalAccess } from "@/lib/security/access";
import {
  assertSameOrigin,
  securityErrorResponse,
} from "@/lib/security/http";
import {
  acquireConcurrency,
  enforceRateLimit,
  reserveDailyAiBudget,
} from "@/lib/security/abuse";
import { writeSecurityAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function event(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({
    type,
    ...(typeof payload === "object" && payload !== null ? payload : { value: payload }),
  })}\n\n`;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ signalId: string }> },
) {
  let signalId: string;
  let rmId = "";
  let releaseConcurrency: (() => void) | undefined;
  try {
    const session = await requireApiSession();
    rmId = session.rmId;
    assertSameOrigin(request);
    enforceRateLimit(request, {
      bucket: "diversification",
      limit: 3,
      windowMs: 10 * 60_000,
      rmId: session.rmId,
    });
    reserveDailyAiBudget(session.rmId, 16_000);
    releaseConcurrency = acquireConcurrency(
      `diversification:${session.rmId}`,
      1,
    );
    signalId = (await context.params).signalId;
    requireSignalAccess(new Repository(), session.rmId, signalId);
  } catch (error) {
    releaseConcurrency?.();
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return Response.json({ error: "Resource not found" }, { status: 404 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (update: ProgressUpdate) => {
        controller.enqueue(encoder.encode(event("progress", update)));
      };
      try {
        const plan = await generateDiversificationPlan(signalId, send);
        writeSecurityAuditEvent({
          rmId,
          eventType: "model_response",
          target: "diversification",
          clientId: plan.client_id,
          metadata: {
            model: "gpt-4o",
            prompt_version: "diversification-v1",
            context_pack_hash: plan.context_pack_hash,
            estimated_tokens_reserved: 16_000,
          },
        });
        controller.enqueue(encoder.encode(event("done", { plan })));
      } catch (error) {
        console.error("Diversification generation error:", error);
        controller.enqueue(
          encoder.encode(
            event("error", {
              error:
                "Failed to generate diversification analysis",
            }),
          ),
        );
      } finally {
        controller.close();
        releaseConcurrency?.();
        releaseConcurrency = undefined;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
