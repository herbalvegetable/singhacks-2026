import assert from "node:assert/strict";
import test from "node:test";
import type { CopilotAnswer } from "../../lib/contracts/chat";
import {
  budgetRecords,
  buildClientContextPack,
  classifyQuery,
  scoreRecord,
} from "../../lib/agents/copilot/retrieval";
import {
  buildVisualizationCandidates,
  materializeVisualization,
  shouldConsiderVisualization,
} from "../../lib/agents/copilot/visualization";
import {
  stripInternalReferenceTags,
  stripInternalReferenceTagsDeep,
} from "../../lib/agents/outputSanitizer";

test("removes internal retrieval tags from generated output", () => {
  assert.equal(
    stripInternalReferenceTags(
      "The risk is elevated [narrative:SIG-CL-0009-PF-0011-DURATION]. Review liquidity (signal:SIG-0001).",
    ),
    "The risk is elevated. Review liquidity.",
  );
  assert.deepEqual(
    stripInternalReferenceTagsDeep({
      answer: "Consider the plan [diversification:PLAN-1].",
      followUps: ["Why [holding:PF-1:INS-1]?"],
    }),
    {
      answer: "Consider the plan.",
      followUps: ["Why?"],
    },
  );
});

test("classifies multi-intent client questions", () => {
  const plan = classifyQuery(
    "What concentration risk affects the Lombard facility and margin trigger?"
  );
  assert.ok(plan.intents.includes("risk"));
  assert.ok(plan.intents.includes("facility"));
  assert.ok(plan.terms.includes("concentration"));
});

test("classifies follow-ups about generated portfolio intelligence", () => {
  const plan = classifyQuery(
    "How does recommended action 2 return under the Hormuz scenario and what is its Sharpe ratio?",
  );
  assert.ok(plan.intents.includes("portfolio"));
  assert.ok(plan.intents.includes("risk"));
  assert.ok(plan.terms.includes("hormuz"));
});

test("ranks matching risk evidence above unrelated records", () => {
  const plan = classifyQuery("Explain concentration risk");
  const matching = scoreRecord(
    {
      ref_id: "signal:1",
      kind: "signal",
      title: "Household concentration risk",
      text: "Concentrated equity position",
      source_refs: [],
      data: { urgency_score: 80 },
    },
    plan
  );
  const unrelated = scoreRecord(
    {
      ref_id: "transaction:1",
      kind: "transaction",
      title: "Coupon payment",
      text: "Cash income",
      source_refs: [],
      data: {},
    },
    plan
  );
  assert.ok(matching > unrelated);
});

test("enforces context budget", () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    ref_id: `record:${index}`,
    kind: "holding",
    title: "Holding",
    text: "x".repeat(200),
    score: 10 - index,
    source_refs: [],
    data: {},
  }));
  const selected = budgetRecords(records, 700);
  assert.ok(JSON.stringify(selected).length < 900);
  assert.ok(selected.length < records.length);
});

test("builds an isolated, hashed client context pack", () => {
  const pack = buildClientContextPack(
    "CL-0001",
    "What are the main concentration risks?"
  );
  assert.equal(pack.client_id, "CL-0001");
  assert.match(pack.context_pack_hash, /^[a-f0-9]{64}$/);
  assert.ok(pack.records.length > 0);
  for (const record of pack.records) {
    if (record.kind === "holding") {
      assert.equal(record.data.client_id, "CL-0001");
    }
  }
});

test("builds grounded allocation data and materializes a requested pie chart", () => {
  const pack = buildClientContextPack(
    "CL-0001",
    "Show me a pie chart of the portfolio allocation",
  );
  const candidates = buildVisualizationCandidates(pack);
  const allocation = candidates.find(
    (candidate) => candidate.candidateId === "portfolio-allocation",
  );
  assert.ok(allocation);
  const total = allocation.series[0].points.reduce(
    (sum, point) => sum + point.value,
    0,
  );
  assert.ok(Math.abs(total - 100) < 0.1);
  const answer: CopilotAnswer = {
    answer: "The portfolio contains several asset-class allocations.",
    citations: [{ ref_id: pack.records[0].ref_id, label: "Client record" }],
    confidence: 80,
    caveat: null,
    refused: false,
    follow_up_questions: ["One?", "Two?", "Three?"],
  };
  assert.equal(
    shouldConsiderVisualization(pack.query, answer, candidates),
    true,
  );
  const chart = materializeVisualization(pack, candidates, {
    shouldDisplay: true,
    candidateId: "portfolio-allocation",
    chartType: "pie",
    title: "Portfolio allocation",
    reason: "A pie chart clearly shows composition of the whole.",
  });
  assert.equal(chart?.type, "pie");
  assert.ok(chart?.source_ref_ids.length);
  const validRefs = new Set(pack.records.map((record) => record.ref_id));
  assert.ok(chart?.source_ref_ids.every((refId) => validRefs.has(refId)));
});

test("rejects action execution without calling the model", async () => {
  process.env.OPENAI_API_KEY ||= "test-key";
  const { answerClientQuestion } = await import(
    "../../lib/agents/copilot/agent"
  );
  const pack = buildClientContextPack(
    "CL-0001",
    "Accept and execute this recommendation"
  );
  const answer = await answerClientQuestion(pack, []);
  assert.equal(answer.refused, true);
  assert.equal(answer.confidence, 100);
  assert.match(answer.answer, /cannot accept/i);
});
