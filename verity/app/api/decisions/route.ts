import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  DecisionLookup,
  DecisionRequest,
} from "@/lib/contracts/decision";
import {
  buildAuditEntryInput,
  DecisionTargetError,
  resolveDecisionTarget,
} from "@/lib/decisions/service";
import { Repository } from "@/lib/db/repository";
import { requireApiSession } from "@/lib/security/auth";
import {
  requireClientAccess,
  ResourceNotFoundError,
} from "@/lib/security/access";
import {
  assertSameOrigin,
  internalErrorResponse,
  securityErrorResponse,
} from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/abuse";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid decision request", issues: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof DecisionTargetError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ResourceNotFoundError) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }
  return internalErrorResponse("Decision request failed", error);
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    enforceRateLimit(request, {
      bucket: "decision-read",
      limit: 60,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    const lookup = DecisionLookup.parse({
      client_id: request.nextUrl.searchParams.get("client_id"),
      target_type: request.nextUrl.searchParams.get("target_type"),
      target_id: request.nextUrl.searchParams.get("target_id"),
    });
    const repository = new Repository();
    requireClientAccess(repository, session.rmId, lookup.client_id);
    const target = resolveDecisionTarget(
      repository,
      lookup.target_type,
      lookup.target_id,
      lookup.client_id,
    );
    const decision = repository.getLatestDecision(
      target.target_type,
      target.target_id,
      target.client_id,
    );
    return NextResponse.json({ decision: decision ?? null });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    enforceRateLimit(request, {
      bucket: "decision-write",
      limit: 30,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    const raw: unknown = await request.json();
    const decision = DecisionRequest.parse(raw);
    const repository = new Repository();
    requireClientAccess(repository, session.rmId, decision.client_id);
    const target = resolveDecisionTarget(
      repository,
      decision.target_type,
      decision.target_id,
      decision.client_id,
    );
    const entry = repository.appendAuditEntry(
      buildAuditEntryInput(decision, target, session.rmId),
    );
    return NextResponse.json(
      {
        decision: entry,
        acknowledgement:
          decision.action === "accept"
            ? "Acknowledged for RM workflow only. No trade has been placed."
            : "Decision recorded. No trade has been placed.",
      },
      { status: 201 },
    );
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return errorResponse(error);
  }
}
