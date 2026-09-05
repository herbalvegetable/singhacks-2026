import assert from "node:assert/strict";
import test from "node:test";
import type { Signal } from "../../lib/contracts/signal";
import type { MarketEvent } from "../../lib/db/repository";

const signal: Signal = {
  signal_id: "SIG-TEST-DURATION",
  client_id: "C-TEST",
  portfolio_ids: ["P-TEST"],
  type: "explanation",
  subtype: "duration_attribution",
  headline: "Fixed income declined as bond prices fell",
  window: { from: "2026-06-01", to: "2026-08-26" },
  magnitude_usd: -100_000,
  magnitude_pct: null,
  direction: "negative",
  urgency_score: 40,
  urgency_breakdown: { materiality: 40 },
  affected_holdings: [
    {
      instrument_id: "BOND-1",
      instrument_name: "Long Duration Bond",
      portfolio_id: "P-TEST",
      market_value_usd: 1_000_000,
      weight_pct: 10,
    },
  ],
  evidence: [
    {
      source: "holdings.csv",
      key: { snapshot_date: "2026-08-26", instrument_id: "BOND-1" },
      fields: ["market_value_usd"],
      values: { market_value_usd: 1_000_000 },
    },
  ],
  data_quality_flags: [],
  computed_at: "2026-09-01T00:00:00.000Z",
};

const events: MarketEvent[] = [
  {
    event_id: "EVT-RATES",
    event_date: "2026-07-29",
    event_type: "Policy",
    region: "United States",
    description: "Policy rates remain elevated.",
    primary_transmission: "Duration, rate-sensitive credit",
    severity: "High",
    transmission_tokens: '["duration","rate-sensitive credit"]',
  },
  {
    event_id: "EVT-ENERGY",
    event_date: "2026-08-05",
    event_type: "Geopolitical",
    region: "Middle East",
    description: "Energy risk premium rises.",
    primary_transmission: "Energy, shipping",
    severity: "Severe",
    transmission_tokens: '["energy","shipping"]',
  },
  {
    event_id: "EVT-OLD",
    event_date: "2025-01-01",
    event_type: "Policy",
    region: "Global",
    description: "Old rate event.",
    primary_transmission: "Duration",
    severity: "Medium",
    transmission_tokens: '["duration"]',
  },
];

test("filters event candidates by topic and date deterministically", async () => {
  process.env.OPENAI_API_KEY ||= "test-key";
  const { filterEventCandidates } = await import(
    "../../lib/agents/groundingAgent"
  );
  const first = filterEventCandidates(signal, events, []);
  const second = filterEventCandidates(signal, [...events].reverse(), []);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((event) => event.event_id), ["EVT-RATES"]);
});

test("hash excludes volatile signal timestamps and no-match stays below 30", async () => {
  process.env.OPENAI_API_KEY ||= "test-key";
  const { buildNoMatchGrounding, filterEventCandidates, hashGroundingInput } =
    await import("../../lib/agents/groundingAgent");
  const candidates = filterEventCandidates(signal, events, []);
  const changedTimestamp = {
    ...signal,
    computed_at: "2026-09-02T00:00:00.000Z",
  };

  assert.equal(
    hashGroundingInput(signal, candidates),
    hashGroundingInput(changedTimestamp, candidates),
  );
  const fallback = buildNoMatchGrounding(signal, []);
  assert.equal(fallback.no_match, true);
  assert.deepEqual(fallback.matched_event_ids, []);
  assert.ok(fallback.confidence < 30);
  assert.match(fallback.explanation.toLowerCase(), /no clear causal link/);
});
