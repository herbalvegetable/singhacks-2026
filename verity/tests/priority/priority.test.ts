import assert from "node:assert/strict";
import test from "node:test";
import type { Repository } from "../../lib/db/repository";

function testRepository(): Repository {
  const clients = Array.from({ length: 20 }, (_, index) => ({
    client_id: `CL-${String(index + 1).padStart(4, "0")}`,
    client_name: `Client ${index + 1}`,
    age: 50,
    tax_domicile: "Singapore",
    objectives: "Preserve and grow wealth",
    life_stage: "Wealth management",
    risk_profile: "Balanced",
    risk_tolerance_score: 5,
    investment_horizon_years: 10,
    liquidity_needs: "Medium",
    total_aum_usd: 10_000_000,
    client_since: "2020-01-01",
  }));
  return {
    getSnapshotDates: async () => ["2026-08-26"],
    getAllClients: async () => clients,
    getClientsForRm: async () => clients,
    getSignalsForClient: async () => [],
    getNarrativesForClient: async () => ({}),
    getHoldingsForClient: async () => [],
    getCashNeedsForClient: async () => [],
    getCommitmentsForClient: async () => [],
    getFacilitiesForClient: async () => [],
    getClientDataQualityFlags: async () => [],
    getFacilitySnapshots: async () => [],
  } as unknown as Repository;
}

test("builds complete, de-identified and reproducibly hashed book risk facts", async () => {
  process.env.OPENAI_API_KEY ||= "test-key";
  const {
    buildBookRiskFacts,
    generateDeterministicRiskPriorities,
    hashBookRiskFacts,
  } = await import(
    "../../lib/agents/priorityAgent"
  );
  const facts = await buildBookRiskFacts(testRepository());
  assert.equal(facts.length, 20);
  assert.equal(new Set(facts.map((fact) => fact.client_id)).size, facts.length);
  assert.ok(
    facts.every((fact) =>
      fact.valid_evidence_ref_ids.includes(`client:${fact.client_id}`),
    ),
  );
  assert.ok(facts.every((fact) => !("client_name" in fact.profile)));
  assert.equal(hashBookRiskFacts(facts), hashBookRiskFacts(facts));
  assert.match(hashBookRiskFacts(facts), /^[a-f0-9]{64}$/);
  const priorities = generateDeterministicRiskPriorities(facts);
  assert.equal(priorities.length, facts.length);
  assert.ok(
    priorities.every(
      (priority, index) =>
        priority.rank === index + 1 &&
        priority.evidence_ref_ids.length > 0 &&
        priority.dimensions.length === 5,
    ),
  );
});
