import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthConfigurationError,
  authenticateCredentials,
  createSession,
} from "@/lib/security/auth";
import {
  assertSameOrigin,
  internalErrorResponse,
  securityErrorResponse,
} from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/abuse";
import { writeSecurityAuditEvent } from "@/lib/security/audit";

const LoginRequest = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(request, {
      bucket: "login",
      limit: 5,
      windowMs: 15 * 60_000,
    });
    const input = LoginRequest.parse(await request.json());
    const identity = authenticateCredentials(input.username, input.password);
    if (!identity) {
      writeSecurityAuditEvent({
        eventType: "authentication_failed",
        target: "login",
      });
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 },
      );
    }
    await createSession(identity);
    writeSecurityAuditEvent({
      rmId: identity.rmId,
      eventType: "authentication_succeeded",
      target: "login",
    });
    return NextResponse.json({
      authenticated: true,
      display_name: identity.displayName,
    });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    if (error instanceof AuthConfigurationError) {
      console.error("Authentication configuration is incomplete");
      return NextResponse.json(
        { error: "Authentication is unavailable" },
        { status: 503 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid login request" },
        { status: 400 },
      );
    }
    return internalErrorResponse("Login failed", error);
  }
}
