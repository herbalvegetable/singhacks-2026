import { createHash } from "crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  RiskPriorityBatch,
  RiskSummaryBatch,
  StoredRiskPriority,
  type RiskPriorityAssessment,
  type RiskSummary,
} from "../contracts/priority";
import { Repository } from "../db/repository";
import { stripInternalReferenceTagsDeep } from "./outputSanitizer";
import {
  OPENAI_REQUEST_OPTIONS,
  requireAgentsEnabled,
} from "./runtime";
import { numbersAreTraceable } from "./outputGuard";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "agents-disabled",
  ...OPENAI_REQUEST_OPTIONS,
});

export const PRIORITY_PROMPT_VERSION = "risk-priority-v1";

const REQUIRED_DIMENSIONS = [
  "signal_severity",
  "liquidity_deadlines",
  "concentration",
  "credit_margin",
  "data_uncertainty",
] as const;

export interface ClientRiskFacts {
  client_id: string;
  as_of: string;
  profile: {
    risk_profile: string;
    risk_tolerance_score: number;
    investment_horizon_years: number;
    liquidity_needs: string;
    objectives: string;
  };
  deterministic_metrics: {
    signal_count: number;
    max_urgency: number;
    largest_holding_pct: number;
    largest_holding_name: string | null;
  };
  signals: Array<Record<string, unknown>>;
  generated_risk_analyses: Array<Record<string, unknown>>;
  cash_needs: Array<Record<string, unknown>>;
  commitments: Array<Record<string, unknown>>;
  credit_facilities: Array<Record<string, unknown>>;
  data_quality_flags: Array<Record<string, unknown>>;
  valid_evidence_ref_ids: string[];
}

function daysBetween(from: string, to: string): number {
  return Math.ceil(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

export async function buildBookRiskFacts(
  repository = new Repository(),
  rmId?: string,
): Promise<ClientRiskFacts[]> {
  const asOf = (await repository.getSnapshotDates()).at(-1);
  if (!asOf) throw new Error("No portfolio snapshots available");

  const clients = await (rmId
    ? repository.getClientsForRm(rmId)
    : repository.getAllClients());
  return Promise.all(clients.map(async (client) => {
    const [
      signals,
      narratives,
      holdings,
      cashNeeds,
      commitments,
      baseFacilities,
      flags,
    ] = await Promise.all([
      repository.getSignalsForClient(client.client_id),
      repository.getNarrativesForClient(client.client_id),
      repository.getHoldingsForClient(client.client_id, asOf),
      repository.getCashNeedsForClient(client.client_id),
      repository.getCommitmentsForClient(client.client_id),
      repository.getFacilitiesForClient(client.client_id),
      repository.getClientDataQualityFlags(client.client_id),
    ]);
    const valueByInstrument = new Map<
      string,
      { name: string; value: number }
    >();
    for (const holding of holdings) {
      const current = valueByInstrument.get(holding.instrument_id) ?? {
        name: holding.instrument_name,
        value: 0,
      };
      current.value += holding.market_value_usd;
      valueByInstrument.set(holding.instrument_id, current);
    }
    const totalValue = [...valueByInstrument.values()].reduce(
      (sum, holding) => sum + holding.value,
      0,
    );
    const largestHolding = [...valueByInstrument.values()].sort(
      (left, right) => right.value - left.value,
    )[0];
    const facilities = await Promise.all(
      baseFacilities.map(async (facility) => ({
        ...facility,
        latest_snapshot: (
          await repository.getFacilitySnapshots(facility.facility_id)
        ).at(-1),
      })),
    );
    const generatedRiskAnalyses = signals
      .filter((signal) => signal.type === "risk")
      .map((signal) => ({
        signal_id: signal.signal_id,
        analysis: narratives[signal.signal_id] ?? null,
        evidence_ref_id: `narrative:${signal.signal_id}`,
      }))
      .filter((analysis) => analysis.analysis !== null);
    const validEvidenceRefIds = [
      `client:${client.client_id}`,
      ...signals.map((signal) => `signal:${signal.signal_id}`),
      ...generatedRiskAnalyses.map(
        (analysis) => analysis.evidence_ref_id,
      ),
      ...holdings.map(
        (holding) =>
          `holding:${holding.portfolio_id}:${holding.instrument_id}`,
      ),
      ...cashNeeds.map((need) => `cash_need:${need.need_id}`),
      ...commitments.map(
        (commitment) => `commitment:${commitment.commitment_id}`,
      ),
      ...facilities.map(
        (facility) => `facility:${facility.facility_id}`,
      ),
      ...flags.map((flag) => `data_quality:${String(flag.flag_id ?? flag.code)}`),
    ];

    return {
      client_id: client.client_id,
      as_of: asOf,
      profile: {
        risk_profile: client.risk_profile,
        risk_tolerance_score: client.risk_tolerance_score,
        investment_horizon_years: client.investment_horizon_years,
        liquidity_needs: client.liquidity_needs,
        objectives: client.objectives,
      },
      deterministic_metrics: {
        signal_count: signals.length,
        max_urgency:
          signals.length > 0
            ? Math.max(...signals.map((signal) => signal.urgency_score))
            : 0,
        largest_holding_pct:
          totalValue > 0 && largestHolding
            ? Number(((largestHolding.value / totalValue) * 100).toFixed(2))
            : 0,
        largest_holding_name: largestHolding?.name ?? null,
      },
      signals: signals.map((signal) => ({
        evidence_ref_id: `signal:${signal.signal_id}`,
        signal_id: signal.signal_id,
        type: signal.type,
        subtype: signal.subtype,
        headline: signal.headline,
        urgency_score: signal.urgency_score,
        magnitude_usd: signal.magnitude_usd,
        magnitude_pct: signal.magnitude_pct,
        direction: signal.direction,
      })),
      generated_risk_analyses: generatedRiskAnalyses,
      cash_needs: cashNeeds.map((need) => ({
        evidence_ref_id: `cash_need:${need.need_id}`,
        description: need.description,
        currency: need.currency,
        amount: need.amount,
        due_from: need.due_from,
        due_to: need.due_to,
        days_until_due_from: daysBetween(asOf, need.due_from),
        certainty: need.certainty,
      })),
      commitments: commitments.map((commitment) => ({
        evidence_ref_id: `commitment:${commitment.commitment_id}`,
        fund_name: commitment.fund_name,
        currency: commitment.currency,
        uncalled: commitment.uncalled,
        expected_call_window: commitment.expected_call_window,
      })),
      credit_facilities: facilities.map((facility) => ({
        evidence_ref_id: `facility:${facility.facility_id}`,
        facility_id: facility.facility_id,
        margin_call_ltv_pct: facility.margin_call_ltv_pct,
        latest_ltv_pct: facility.latest_snapshot?.ltv_pct ?? null,
        latest_headroom: facility.latest_snapshot?.headroom ?? null,
      })),
      data_quality_flags: flags.map((flag) => ({
        evidence_ref_id: `data_quality:${String(flag.flag_id ?? flag.code)}`,
        code: flag.code,
        severity: flag.severity,
        description: flag.description,
      })),
      valid_evidence_ref_ids: [...new Set(validEvidenceRefIds)],
    };
  }));
}

export function hashBookRiskFacts(facts: ClientRiskFacts[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ prompt: PRIORITY_PROMPT_VERSION, facts }))
    .digest("hex");
}

function deterministicSeverity(score: number) {
  if (score >= 75) return "critical" as const;
  if (score >= 55) return "high" as const;
  if (score >= 30) return "moderate" as const;
  return "low" as const;
}

export function generateDeterministicRiskPriorities(
  facts: ClientRiskFacts[],
): StoredRiskPriority[] {
  const inputHash = hashBookRiskFacts(facts);
  const generatedAt = new Date().toISOString();
  const assessments = facts.map((fact) => {
    const signalScore = fact.deterministic_metrics.max_urgency;
    const concentrationScore = Math.min(
      100,
      fact.deterministic_metrics.largest_holding_pct * 2,
    );
    const nearestCashNeed = Math.min(
      ...fact.cash_needs.map((need) =>
        typeof need.days_until_due_from === "number"
          ? need.days_until_due_from
          : Number.POSITIVE_INFINITY,
      ),
    );
    const liquidityScore =
      nearestCashNeed <= 30
        ? 85
        : nearestCashNeed <= 90
          ? 60
          : fact.commitments.length > 0
            ? 35
            : 10;
    const creditScore = fact.credit_facilities.reduce((highest, facility) => {
      const ltv = Number(facility.latest_ltv_pct);
      const trigger = Number(facility.margin_call_ltv_pct);
      if (!Number.isFinite(ltv) || !Number.isFinite(trigger) || trigger <= 0) {
        return highest;
      }
      return Math.max(highest, Math.min(100, (ltv / trigger) * 100));
    }, 0);
    const dataScore = fact.data_quality_flags.some(
      (flag) => flag.severity === "error",
    )
      ? 75
      : fact.data_quality_flags.length > 0
        ? 45
        : 5;
    const riskScore = Math.max(
      1,
      Math.min(
        100,
        Math.round(
          signalScore * 0.35 +
            concentrationScore * 0.25 +
            liquidityScore * 0.15 +
            creditScore * 0.15 +
            dataScore * 0.1,
        ),
      ),
    );
    const dimensions = [
      {
        dimension: "signal_severity" as const,
        score: signalScore,
        rationale: `${fact.deterministic_metrics.signal_count} active signals; maximum urgency ${signalScore}.`,
      },
      {
        dimension: "liquidity_deadlines" as const,
        score: liquidityScore,
        rationale: Number.isFinite(nearestCashNeed)
          ? `Nearest planned cash need is in ${nearestCashNeed} days.`
          : `${fact.commitments.length} outstanding commitment records and no dated cash need.`,
      },
      {
        dimension: "concentration" as const,
        score: concentrationScore,
        rationale: `Largest household position is ${fact.deterministic_metrics.largest_holding_pct}%${fact.deterministic_metrics.largest_holding_name ? ` in ${fact.deterministic_metrics.largest_holding_name}` : ""}.`,
      },
      {
        dimension: "credit_margin" as const,
        score: creditScore,
        rationale:
          fact.credit_facilities.length > 0
            ? `Highest current LTV uses ${Math.round(creditScore)}% of its margin-call threshold.`
            : "No credit facility exposure is recorded.",
      },
      {
        dimension: "data_uncertainty" as const,
        score: dataScore,
        rationale: `${fact.data_quality_flags.length} relevant data-quality flags.`,
      },
    ];
    const keyRisks = dimensions
      .filter((dimension) => dimension.score >= 30)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((dimension) => dimension.rationale);
    return {
      client_id: fact.client_id,
      risk_score: riskScore,
      attention_band:
        riskScore >= 75
          ? "call_today" as const
          : riskScore >= 40
            ? "this_week" as const
            : "monitor" as const,
      rationale: `Deterministic score based on signal urgency, concentration, liquidity, credit, and data quality.`,
      dimensions: dimensions.map(({ dimension, score, rationale }) => ({
        dimension,
        severity: deterministicSeverity(score),
        rationale,
      })),
      evidence_ref_ids: fact.valid_evidence_ref_ids.slice(0, 12),
      confidence: fact.data_quality_flags.length > 0 ? 70 : 85,
      risk_summary:
        keyRisks[0] ??
        "No strong evidence of immediate portfolio attention was identified.",
      key_risks: keyRisks,
      uncertainty:
        fact.data_quality_flags.length > 0
          ? "Data-quality flags reduce scoring confidence."
          : null,
      input_hash: inputHash,
      generated_at: generatedAt,
    };
  });
  return assessments
    .sort(
      (left, right) =>
        right.risk_score - left.risk_score ||
        left.client_id.localeCompare(right.client_id),
    )
    .map((priority, index) =>
      StoredRiskPriority.parse({ ...priority, rank: index + 1 }),
    );
}

function requireCompleteClientSet<T extends { client_id: string }>(
  values: T[],
  facts: ClientRiskFacts[],
  stage: string,
): T[] {
  const expected = new Set(facts.map((fact) => fact.client_id));
  const byClient = new Map(values.map((value) => [value.client_id, value]));
  if (
    byClient.size !== expected.size ||
    [...expected].some((clientId) => !byClient.has(clientId))
  ) {
    throw new Error(`${stage} did not return exactly one result per client`);
  }
  return [...expected].map((clientId) => byClient.get(clientId)!);
}

async function generateRiskSummaries(
  facts: ClientRiskFacts[],
): Promise<RiskSummary[]> {
  const completion = await openai.chat.completions.parse({
    model: "gpt-4o",
    temperature: 0.1,
    response_format: zodResponseFormat(
      RiskSummaryBatch,
      "book_risk_summaries",
    ),
    messages: [
      {
        role: "system",
        content: `You are Stage 1 of Verity's RM risk prioritization workflow.
Create exactly one concise risk summary for every supplied client ID.
Use only supplied facts and copy numbers exactly. Existing generated_risk_analyses are generated interpretations, while signals and metrics are computed facts; preserve that distinction.
Name concrete risks, deadlines, concentration, margin proximity, and uncertainty where present.
Every key claim must cite evidence_ref_ids from that client's valid list.
Do not rank clients or assign a risk score in this stage.
Return summaries in the same client order. Do not expose hidden chain-of-thought.`,
      },
      {
        role: "user",
        content: JSON.stringify({ clients: facts }),
      },
    ],
    max_completion_tokens: 5000,
  });
  const parsed = completion.choices[0].message.parsed;
  if (!parsed) throw new Error("Risk summary stage returned no structured result");
  const summaries = requireCompleteClientSet(
    parsed.summaries,
    facts,
    "Risk summary stage",
  );
  for (const summary of summaries) {
    const fact = facts.find((item) => item.client_id === summary.client_id)!;
    if (
      !numbersAreTraceable(
        [summary.summary, ...summary.key_risks, summary.uncertainty ?? ""].join(
          "\n",
        ),
        fact,
      )
    ) {
      throw new Error(`Risk summary for ${summary.client_id} altered a number`);
    }
  }
  return summaries;
}

function normalizeEvidence(
  clientId: string,
  refs: string[],
  facts: ClientRiskFacts[],
): string[] {
  const fact = facts.find((item) => item.client_id === clientId);
  if (!fact) throw new Error("Priority result referenced an unknown client");
  const valid = new Set(fact.valid_evidence_ref_ids);
  const filtered = [...new Set(refs.filter((refId) => valid.has(refId)))];
  if (filtered.length === 0) {
    throw new Error(`Priority result for ${clientId} had no valid evidence`);
  }
  return filtered;
}

async function scoreRiskSummaries(
  facts: ClientRiskFacts[],
  summaries: RiskSummary[],
): Promise<RiskPriorityAssessment[]> {
  const compactFacts = facts.map((fact) => ({
    client_id: fact.client_id,
    deterministic_metrics: fact.deterministic_metrics,
    cash_needs: fact.cash_needs,
    commitments: fact.commitments,
    credit_facilities: fact.credit_facilities,
    data_quality_flags: fact.data_quality_flags,
    valid_evidence_ref_ids: fact.valid_evidence_ref_ids,
    generated_risk_summary: summaries.find(
      (summary) => summary.client_id === fact.client_id,
    ),
  }));
  const completion = await openai.chat.completions.parse({
    model: "gpt-4o",
    temperature: 0.05,
    response_format: zodResponseFormat(
      RiskPriorityBatch,
      "book_risk_priorities",
    ),
    messages: [
      {
        role: "system",
        content: `You are Stage 2 of Verity's RM risk prioritization workflow.
Score every supplied client from 1 (least immediate RM attention required) to 100 (most immediate risk) relative to this book.

Assess exactly five dimensions: signal_severity, liquidity_deadlines, concentration, credit_margin, and data_uncertainty. For each, return a severity and one concise evidence-based rationale. These are auditable factor assessments, not hidden chain-of-thought.

Calibration:
- 90-100: imminent severe loss, margin call, or confirmed near-term obligation at risk
- 70-89: high-severity breach, concentration, or unresolved deadline requiring prompt action
- 40-69: meaningful risk needing review this week
- 1-39: monitor; no strong evidence of immediate attention

Use only supplied numbers and evidence IDs. Do not perform new financial calculations. Return exactly one assessment per client in input order.`,
      },
      {
        role: "user",
        content: JSON.stringify({ clients: compactFacts }),
      },
    ],
    max_completion_tokens: 7000,
  });
  const parsed = completion.choices[0].message.parsed;
  if (!parsed) throw new Error("Risk score stage returned no structured result");
  const assessments = requireCompleteClientSet(
    parsed.assessments,
    facts,
    "Risk score stage",
  );
  for (const assessment of assessments) {
    const source = compactFacts.find(
      (item) => item.client_id === assessment.client_id,
    )!;
    if (
      !numbersAreTraceable(
        [
          assessment.rationale,
          ...assessment.dimensions.map((dimension) => dimension.rationale),
        ].join("\n"),
        source,
      )
    ) {
      throw new Error(
        `Risk assessment for ${assessment.client_id} altered a number`,
      );
    }
  }
  return assessments;
}

export async function generateBookRiskPriorities(
  repository = new Repository(),
  prefetchedFacts?: ClientRiskFacts[],
): Promise<{ inputHash: string; priorities: StoredRiskPriority[] }> {
  requireAgentsEnabled();
  const facts = prefetchedFacts ?? await buildBookRiskFacts(repository);
  const inputHash = hashBookRiskFacts(facts);
  const summaries = (await generateRiskSummaries(facts)).map((summary) => ({
    ...summary,
    evidence_ref_ids: normalizeEvidence(
      summary.client_id,
      summary.evidence_ref_ids,
      facts,
    ),
  }));
  const assessments = await scoreRiskSummaries(facts, summaries);
  const generatedAt = new Date().toISOString();
  const ranked = assessments
    .map((assessment) => ({
      ...assessment,
      evidence_ref_ids: normalizeEvidence(
        assessment.client_id,
        assessment.evidence_ref_ids,
        facts,
      ),
      dimensions: REQUIRED_DIMENSIONS.map(
        (dimension) =>
          assessment.dimensions.find(
            (item) => item.dimension === dimension,
          ) ?? {
            dimension,
            severity: "low" as const,
            rationale:
              "No distinct evidence for this dimension was identified in the supplied risk summary.",
          },
      ),
      risk_score: Math.max(1, Math.min(100, Math.round(assessment.risk_score))),
    }))
    .sort(
      (left, right) =>
        right.risk_score - left.risk_score ||
        left.client_id.localeCompare(right.client_id),
    );
  const priorities = ranked.map((assessment, index) => {
    const summary = summaries.find(
      (item) => item.client_id === assessment.client_id,
    )!;
    return StoredRiskPriority.parse(
      stripInternalReferenceTagsDeep({
        ...assessment,
        attention_band:
          assessment.risk_score >= 75
            ? "call_today"
            : assessment.risk_score >= 40
              ? "this_week"
              : "monitor",
        rank: index + 1,
        risk_summary: summary.summary,
        key_risks: summary.key_risks,
        uncertainty: summary.uncertainty,
        input_hash: inputHash,
        generated_at: generatedAt,
      }),
    );
  });
  return { inputHash, priorities };
}
