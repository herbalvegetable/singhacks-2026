import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Repository } from "@/lib/db/repository";
import { requireApiSession } from "@/lib/security/auth";
import { requireClientAccess } from "@/lib/security/access";
import { enforceRateLimit } from "@/lib/security/abuse";
import { writeSecurityAuditEvent } from "@/lib/security/audit";
import {
  assertSameOrigin,
  internalErrorResponse,
  securityErrorResponse,
} from "@/lib/security/http";

const CitationView = z.object({
  client_id: z.string().regex(/^CL-\d{4}$/),
  ref_id: z.string().trim().min(1).max(180),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    assertSameOrigin(request);
    enforceRateLimit(request, {
      bucket: "citation-view",
      limit: 120,
      windowMs: 5 * 60_000,
      rmId: session.rmId,
    });
    const input = CitationView.parse(await request.json());
    requireClientAccess(new Repository(), session.rmId, input.client_id);
    writeSecurityAuditEvent({
      rmId: session.rmId,
      eventType: "citation_viewed",
      target: input.ref_id,
      clientId: input.client_id,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid citation event" },
        { status: 400 },
      );
    }
    return internalErrorResponse("Unable to record citation event", error);
  }
}
