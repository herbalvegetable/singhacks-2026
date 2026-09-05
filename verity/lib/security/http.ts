import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { AuthenticationError } from "./auth";
import { BudgetExceededError, RateLimitError } from "./abuse";
import { ResourceNotFoundError } from "./access";
import { originMatchesHost } from "./originPolicy";

export class CsrfError extends Error {
  constructor() {
    super("Invalid request origin");
  }
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!originMatchesHost(origin, host)) throw new CsrfError();
}

export function securityErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthenticationError) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  if (error instanceof CsrfError) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      },
    );
  }
  if (error instanceof BudgetExceededError) {
    return NextResponse.json(
      { error: "Daily AI budget exceeded" },
      { status: 429 },
    );
  }
  if (error instanceof ResourceNotFoundError) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }
  return null;
}

export function internalErrorResponse(
  publicMessage: string,
  error: unknown,
  status = 500,
): NextResponse {
  const correlationId = randomUUID();
  console.error(
    `[${correlationId}] ${publicMessage}:`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    { error: publicMessage, correlation_id: correlationId },
    { status },
  );
}
