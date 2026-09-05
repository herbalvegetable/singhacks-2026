import assert from "node:assert/strict";
import test from "node:test";
import { originMatchesHost } from "../../lib/security/originPolicy";
import { evaluateRateLimit } from "../../lib/security/rateLimitPolicy";
import { sessionIsActive } from "../../lib/security/sessionPolicy";

test("same-origin policy rejects missing and cross-site origins", () => {
  assert.equal(originMatchesHost(null, "verity.test"), false);
  assert.equal(
    originMatchesHost("https://attacker.test", "verity.test"),
    false,
  );
  assert.equal(
    originMatchesHost("https://verity.test", "verity.test"),
    true,
  );
});

test("rate policy blocks over-limit requests and resets its window", () => {
  const start = 1_000_000;
  const second = evaluateRateLimit(
    { windowStart: start, count: 1 },
    start + 100,
    2,
    60_000,
  );
  assert.equal(second.allowed, true);
  const blocked = evaluateRateLimit(
    { windowStart: start, count: 2 },
    start + 200,
    2,
    60_000,
  );
  assert.equal(blocked.allowed, false);
  const reset = evaluateRateLimit(
    { windowStart: start, count: 2 },
    start + 60_000,
    2,
    60_000,
  );
  assert.deepEqual(reset, {
    allowed: true,
    state: { windowStart: start + 60_000, count: 1 },
  });
});

test("session policy rejects expired and revoked sessions", () => {
  const now = new Date("2026-09-05T05:00:00.000Z");
  assert.equal(
    sessionIsActive("2026-09-05T06:00:00.000Z", null, now),
    true,
  );
  assert.equal(
    sessionIsActive("2026-09-05T04:00:00.000Z", null, now),
    false,
  );
  assert.equal(
    sessionIsActive(
      "2026-09-05T06:00:00.000Z",
      "2026-09-05T04:30:00.000Z",
      now,
    ),
    false,
  );
});
