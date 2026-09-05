import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentSession,
  revokeCurrentSession,
} from "@/lib/security/auth";
import {
  assertSameOrigin,
  internalErrorResponse,
  securityErrorResponse,
} from "@/lib/security/http";
import { writeSecurityAuditEvent } from "@/lib/security/audit";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const session = await getCurrentSession();
    await revokeCurrentSession();
    writeSecurityAuditEvent({
      rmId: session?.rmId,
      eventType: "session_revoked",
      target: "logout",
    });
    return NextResponse.json({ authenticated: false });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return internalErrorResponse("Logout failed", error);
  }
}
