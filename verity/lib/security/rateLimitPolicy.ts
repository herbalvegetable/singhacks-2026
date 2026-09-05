export interface RateLimitState {
  windowStart: number;
  count: number;
}

export function evaluateRateLimit(
  current: RateLimitState | null,
  now: number,
  limit: number,
  windowMs: number,
):
  | { allowed: true; state: RateLimitState }
  | { allowed: false; retryAfterSeconds: number } {
  const reset = !current || now - current.windowStart >= windowMs;
  const state = {
    windowStart: reset ? now : current.windowStart,
    count: reset ? 1 : current.count + 1,
  };
  if (state.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((state.windowStart + windowMs - now) / 1000),
      ),
    };
  }
  return { allowed: true, state };
}
