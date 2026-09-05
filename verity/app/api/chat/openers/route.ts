import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { requireApiSession } from "@/lib/security/auth";
import { requireClientAccess } from "@/lib/security/access";
import {
  internalErrorResponse,
  securityErrorResponse,
} from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/abuse";

export const dynamic = "force-dynamic";

export async function buildOpeners(
  clientId: string,
  repository = new Repository(),
) {
  const [client, clientSignals] = await Promise.all([
    repository.getClient(clientId),
    repository.getSignalsForClient(clientId),
  ]);
  if (!client) throw new Error("Client not found");

  const signals = clientSignals.sort(
    (a, b) => b.urgency_score - a.urgency_score,
  );

  const questions = signals.slice(0, 3).map((signal) => {
    if (signal.type === "risk") {
      return `What makes “${signal.headline}” important for ${client.client_name}?`;
    }
    if (signal.type === "liquidity") {
      return `How does the liquidity signal affect ${client.client_name}?`;
    }
    return `Explain the evidence behind “${signal.headline}”.`;
  });

  const fallbacks = [
    "What are the most important portfolio risks for this client?",
    "Which holdings and signals need attention before the next meeting?",
    "What data-quality caveats should I know before making a recommendation?",
  ];

  return [...questions, ...fallbacks].slice(0, 3).map((question) =>
    question.length <= 110 ? question : `${question.slice(0, 107)}...`
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await enforceRateLimit(request, {
      bucket: "chat-openers",
      limit: 60,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    const clientId = request.nextUrl.searchParams.get("clientId");
    if (!clientId || !/^CL-\d{4}$/.test(clientId)) {
      return NextResponse.json({ error: "Valid clientId required" }, { status: 400 });
    }
    const repository = new Repository();
    await requireClientAccess(repository, session.rmId, clientId);
    return NextResponse.json({
      questions: await buildOpeners(clientId, repository),
    });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Unable to load openers", error);
  }
}
