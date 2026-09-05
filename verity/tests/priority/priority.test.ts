import assert from "node:assert/strict";
import test from "node:test";

test("builds complete, de-identified and reproducibly hashed book risk facts", async () => {
  process.env.OPENAI_API_KEY ||= "test-key";
  const { buildBookRiskFacts, hashBookRiskFacts } = await import(
    "../../lib/agents/priorityAgent"
  );
  const facts = buildBookRiskFacts();
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
});
