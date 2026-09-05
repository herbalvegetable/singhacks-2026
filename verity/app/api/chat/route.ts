import { NextRequest } from "next/server";
import { ChatRequest } from "@/lib/contracts/chat";
import { buildClientContextPack } from "@/lib/agents/copilot/retrieval";
import { answerClientQuestion } from "@/lib/agents/copilot/agent";
import { planCopilotVisualization } from "@/lib/agents/copilot/chartPlanner";
import { Repository } from "@/lib/db/repository";
import { requireApiSession } from "@/lib/security/auth";
import { requireClientAccess } from "@/lib/security/access";
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
import {
  appendConversationExchange,
  openConversation,
} from "@/lib/security/conversation";
import { writeSecurityAuditEvent } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

function event(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(
    typeof payload === "object" && payload !== null ? payload : { value: payload }
  ) })}\n\n`;
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
      console.error("Unable to release chat concurrency lease:", error);
    }
  };
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    await enforceRateLimit(request, {
      bucket: "chat",
      limit: 20,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    releaseConcurrency = await acquireConcurrency(`chat:${session.rmId}`, 2);
    await reserveDailyAiBudget(session.rmId, 4_000);
    const input = ChatRequest.parse(await request.json());
    const repository = new Repository();
    await requireClientAccess(repository, session.rmId, input.client_id);
    const pack = await buildClientContextPack(
      input.client_id,
      input.query,
      repository,
    );
    const conversation = await openConversation({
      conversationId: input.conversation_id,
      rmId: session.rmId,
      clientId: input.client_id,
    });
    const answer = await answerClientQuestion(pack, conversation.history);
    await writeSecurityAuditEvent({
      rmId: session.rmId,
      eventType: answer.refused ? "model_refusal" : "model_response",
      target: "copilot",
      clientId: input.client_id,
      metadata: {
        model: "gpt-4o",
        prompt_version: "copilot-v3",
        context_pack_hash: pack.context_pack_hash,
        estimated_tokens_reserved: 4_000,
        refused: answer.refused,
        citation_count: answer.citations.length,
      },
    });
    await appendConversationExchange({
      conversationId: conversation.conversationId,
      query: input.query,
      answer: answer.answer,
    });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              event("context", {
                conversation_id: conversation.conversationId,
                context_pack_hash: pack.context_pack_hash,
                retrieved_records: pack.records.length,
              })
            )
          );

          const chunks = answer.answer.match(/.{1,90}(?:\s|$)/g) ?? [answer.answer];
          for (const delta of chunks) {
            controller.enqueue(encoder.encode(event("text_delta", { delta })));
          }

          controller.enqueue(
            encoder.encode(event("citations", { citations: answer.citations }))
          );
          controller.enqueue(
            encoder.encode(
              event("confidence", {
                confidence: answer.confidence,
                caveat: answer.caveat,
                refused: answer.refused,
              })
            )
          );

          try {
            controller.enqueue(
              encoder.encode(
                event("visualization_status", {
                  status: "planning",
                  message: "Checking whether a chart would clarify this answer",
                })
              )
            );
            const visualization = await planCopilotVisualization(pack, answer);
            controller.enqueue(
              encoder.encode(
                visualization.chart
                  ? event("visualization", {
                      chart: visualization.chart,
                      reason: visualization.reason,
                    })
                  : event("visualization_status", {
                      status: "skipped",
                      message: visualization.reason,
                    })
              )
            );
          } catch (visualizationError) {
            console.error("Copilot visualization planning error:", visualizationError);
            controller.enqueue(
              encoder.encode(
                event("visualization_status", {
                  status: "skipped",
                  message:
                    "The answer is available, but a grounded visualization could not be produced.",
                })
              )
            );
          }
          controller.enqueue(
            encoder.encode(
              event("follow_ups", {
                questions: answer.follow_up_questions,
              })
            )
          );
          controller.enqueue(encoder.encode(event("done", {})));
        } catch (streamError) {
          if (!request.signal.aborted) {
            console.error("Copilot stream error:", streamError);
          }
        } finally {
          await releaseLease();
          try {
            controller.close();
          } catch {
            // The consumer may already have canceled the stream.
          }
        }
      },
      async cancel() {
        await releaseLease();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    await releaseLease();
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse(
      "Unable to answer this question",
      error,
      400,
    );
  }
}
