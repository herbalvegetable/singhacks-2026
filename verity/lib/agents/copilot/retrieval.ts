import { createHash } from "crypto";
import { Repository } from "../../db/repository";
import type {
  ContextPack,
  RetrievedRecord,
  RetrievalPlan,
} from "../../contracts/chat";
import type { SourceRef } from "../../contracts/signal";
import type { DiversificationPlan } from "../../contracts/diversification";
import {
  containsInstructionInjection,
  untrustedDataBlock,
} from "../inputGuard";

const STOP_WORDS = new Set([
  "about", "after", "again", "client", "could", "does", "from", "have",
  "portfolio", "should", "that", "their", "there", "these", "this", "what",
  "when", "where", "which", "with", "would",
]);

const INTENT_TERMS: Record<RetrievalPlan["intents"][number], string[]> = {
  portfolio: [
    "portfolio", "holding", "position", "allocation", "exposure", "aum",
    "diversify", "diversification", "scenario", "projection", "return",
    "recommendation", "recommended action",
  ],
  signal: ["signal", "insight", "change", "explain", "explanation", "analysis", "why"],
  risk: [
    "risk", "concentration", "loss", "downside", "urgency", "volatile",
    "volatility", "drawdown", "sharpe", "var", "cvar",
  ],
  liquidity: ["liquidity", "cash", "need", "bill", "commitment", "shortfall"],
  mandate: ["mandate", "limit", "band", "breach", "profile", "suitable"],
  transaction: ["transaction", "trade", "buy", "sell", "flow", "activity"],
  facility: ["facility", "credit", "loan", "lombard", "ltv", "margin", "collateral"],
  source: ["source", "evidence", "citation", "data", "basis"],
  general: [],
};

export function tokenize(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
  )];
}

export function classifyQuery(query: string): RetrievalPlan {
  const normalized = query.toLowerCase();
  const intents = (Object.keys(INTENT_TERMS) as RetrievalPlan["intents"]).filter(
    (intent) =>
      intent !== "general" &&
      INTENT_TERMS[intent].some((term) => normalized.includes(term))
  );

  return {
    intents: intents.length > 0 ? intents : ["general"],
    terms: tokenize(query),
    needs_history: /\b(history|historical|over time|trend|changed?)\b/i.test(query),
    needs_notes: /\b(note|conversation|preference|refus|said|mentioned)\b/i.test(query),
  };
}

function sourceRef(
  source: SourceRef["source"],
  key: Record<string, string>,
  fields: string[],
  values: SourceRef["values"]
): SourceRef {
  return { source, key, fields, values };
}

function baseScore(kind: string, plan: RetrievalPlan): number {
  const mapping: Record<string, RetrievalPlan["intents"][number][]> = {
    client: ["general", "portfolio", "mandate"],
    signal: ["signal", "risk", "source"],
    holding: ["portfolio", "risk", "source"],
    mandate: ["mandate", "risk"],
    facility: ["facility", "risk", "liquidity"],
    cash_need: ["liquidity", "risk"],
    commitment: ["liquidity", "risk"],
    transaction: ["transaction", "portfolio"],
    note: ["general", "signal"],
    narrative: ["signal", "risk", "general"],
    diversification_plan: ["portfolio", "risk", "mandate", "signal", "general"],
  };
  return plan.intents.some((intent) => mapping[kind]?.includes(intent)) ? 30 : 5;
}

export function scoreRecord(
  record: Omit<RetrievedRecord, "score">,
  plan: RetrievalPlan
): number {
  const haystack = `${record.title} ${record.text} ${JSON.stringify(record.data)}`.toLowerCase();
  const termScore = plan.terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 12 : 0),
    0
  );
  const urgency = record.kind === "signal"
    ? Math.min(Number(record.data.urgency_score ?? 0) / 4, 25)
    : 0;
  return baseScore(record.kind, plan) + termScore + urgency;
}

export function budgetRecords(
  records: RetrievedRecord[],
  maxCharacters = 18_000
): RetrievedRecord[] {
  const selected: RetrievedRecord[] = [];
  let size = 0;
  for (const record of [...records].sort((a, b) => b.score - a.score)) {
    const recordSize = JSON.stringify(record).length;
    if (size + recordSize > maxCharacters) continue;
    selected.push(record);
    size += recordSize;
  }
  return selected;
}

function compactProjection(
  projection: DiversificationPlan["baseline_projections"][number],
) {
  const milestoneMonths = new Set([6, 12, 24, 36]);
  return {
    scenario_id: projection.scenario_id,
    scenario_name: projection.scenario_name,
    terminal_p10: projection.terminal_p10,
    terminal_p50: projection.terminal_p50,
    terminal_p90: projection.terminal_p90,
    expected_return_pct: projection.expected_return_pct,
    annualized_return_pct: projection.annualized_return_pct,
    annualized_volatility_pct: projection.annualized_volatility_pct,
    sharpe_ratio: projection.sharpe_ratio,
    value_at_risk_95_usd: projection.value_at_risk_95_usd,
    conditional_var_95_usd: projection.conditional_var_95_usd,
    max_drawdown_pct: projection.max_drawdown_pct,
    probability_of_loss_pct: projection.probability_of_loss_pct,
    milestones: projection.points
      .filter((point) => milestoneMonths.has(point.month))
      .map((point) => ({
        month: point.month,
        p10_value: point.p10_value,
        p50_value: point.p50_value,
        p90_value: point.p90_value,
        cumulative_return_pct: point.cumulative_return_pct,
      })),
  };
}

export function compactDiversificationPlan(plan: DiversificationPlan) {
  return {
    plan_id: plan.plan_id,
    signal_id: plan.signal_id,
    as_of: plan.as_of,
    horizon_months: plan.horizon_months,
    currency: plan.currency,
    baseline_value_usd: plan.baseline_value_usd,
    assumption_set_version: plan.assumption_set_version,
    confidence: plan.confidence,
    generated_at: plan.generated_at,
    caveats: plan.caveats,
    assumptions: plan.assumptions,
    hold_current_scenarios: plan.baseline_projections.map(compactProjection),
    recommended_actions: plan.actions.map((result) => ({
      action_id: result.action.action_id,
      title: result.action.title,
      thesis: result.action.thesis,
      objective_alignment: result.action.objective_alignment,
      trades: result.action.trades,
      target_allocations: result.action.target_allocations,
      caveats: result.action.caveats,
      risk: result.risk,
      ai_summary: result.summary,
      scenarios: result.projections.map(compactProjection),
    })),
  };
}

export function buildClientContextPack(
  clientId: string,
  query: string,
  repository = new Repository()
): ContextPack {
  const client = repository.getClient(clientId);
  if (!client) throw new Error("Client not found");

  const dates = repository.getSnapshotDates();
  const asOf = dates.at(-1);
  if (!asOf) throw new Error("No holding snapshots available");

  const plan = classifyQuery(query);
  const portfolios = repository.getPortfoliosForClient(clientId);
  const holdings = repository.getHoldingsForClient(clientId, asOf);
  const signals = repository.getSignalsForClient(clientId);
  const narratives = repository.getNarrativesForClient(clientId);
  const diversificationPlans =
    repository.getDiversificationPlansForClient(clientId);
  const flags = repository.getClientDataQualityFlags(clientId);
  const records: Array<Omit<RetrievedRecord, "score">> = [];

  records.push({
    ref_id: `client:${clientId}`,
    kind: "client",
    title: `${client.client_name} profile`,
    text: `Risk profile ${client.risk_profile}; life stage ${client.life_stage}; objectives ${client.objectives}; tax domicile ${client.tax_domicile}.`,
    source_refs: [
      sourceRef(
        "clients.csv",
        { client_id: clientId },
        ["risk_profile", "life_stage", "objectives", "tax_domicile", "total_aum_usd"],
        {
          risk_profile: client.risk_profile,
          life_stage: client.life_stage,
          objectives: client.objectives,
          tax_domicile: client.tax_domicile,
          total_aum_usd: client.total_aum_usd,
        }
      ),
    ],
    data: { ...client },
  });

  for (const signal of signals) {
    records.push({
      ref_id: `signal:${signal.signal_id}`,
      kind: "signal",
      title: signal.headline,
      text: `${signal.type} ${signal.subtype}; urgency ${signal.urgency_score}; direction ${signal.direction}.`,
      source_refs: signal.evidence,
      data: {
        signal_id: signal.signal_id,
        type: signal.type,
        subtype: signal.subtype,
        urgency_score: signal.urgency_score,
        magnitude_usd: signal.magnitude_usd,
        magnitude_pct: signal.magnitude_pct,
        affected_holdings: signal.affected_holdings,
      },
    });
  }

  for (const holding of holdings) {
    records.push({
      ref_id: `holding:${holding.portfolio_id}:${holding.instrument_id}`,
      kind: "holding",
      title: holding.instrument_name,
      text: `${holding.asset_class} position worth USD ${holding.market_value_usd}; portfolio weight ${holding.weight_pct}%; unrealised P&L ${holding.unrealised_pnl_base ?? "unavailable"}.`,
      source_refs: [
        sourceRef(
          "holdings.csv",
          {
            snapshot_date: asOf,
            portfolio_id: holding.portfolio_id,
            instrument_id: holding.instrument_id,
          },
          ["market_value_usd", "weight_pct", "unrealised_pnl_base", "liquidity_tier"],
          {
            market_value_usd: holding.market_value_usd,
            weight_pct: holding.weight_pct,
            unrealised_pnl_base: holding.unrealised_pnl_base,
            liquidity_tier: holding.liquidity_tier,
          }
        ),
      ],
      data: { ...holding },
    });
  }

  for (const portfolio of portfolios) {
    const mandates = repository.getMandatesForCode(portfolio.mandate_code);
    records.push({
      ref_id: `mandate:${portfolio.portfolio_id}`,
      kind: "mandate",
      title: `${portfolio.portfolio_name} mandate`,
      text: `${portfolio.service_model} portfolio under mandate ${portfolio.mandate_code}.`,
      source_refs: [
        sourceRef(
          "portfolios.csv",
          { portfolio_id: portfolio.portfolio_id },
          ["mandate_code", "service_model"],
          {
            mandate_code: portfolio.mandate_code,
            service_model: portfolio.service_model,
          }
        ),
        ...mandates.map((mandate) =>
          sourceRef(
            "mandates.csv",
            { mandate_code: mandate.mandate_code, asset_class: mandate.asset_class },
            ["min_pct", "target_pct", "max_pct", "max_single_position_pct"],
            {
              min_pct: mandate.min_pct,
              target_pct: mandate.target_pct,
              max_pct: mandate.max_pct,
              max_single_position_pct: mandate.max_single_position_pct,
            }
          )
        ),
      ],
      data: { portfolio, mandates },
    });
  }

  for (const facility of repository.getFacilitiesForClient(clientId)) {
    const snapshots = repository.getFacilitySnapshots(facility.facility_id);
    records.push({
      ref_id: `facility:${facility.facility_id}`,
      kind: "facility",
      title: `${facility.facility_id} credit facility`,
      text: `Margin trigger ${facility.margin_call_ltv_pct}%; latest LTV ${snapshots.at(-1)?.ltv_pct ?? "unavailable"}%.`,
      source_refs: [
        sourceRef(
          "credit_facilities.csv",
          { facility_id: facility.facility_id },
          ["margin_call_ltv_pct", "collateral_portfolio_id", "facility_ccy"],
          {
            margin_call_ltv_pct: facility.margin_call_ltv_pct,
            collateral_portfolio_id: facility.collateral_portfolio_id,
            facility_ccy: facility.facility_ccy,
          }
        ),
      ],
      data: { facility, snapshots },
    });
  }

  for (const need of repository.getCashNeedsForClient(clientId)) {
    records.push({
      ref_id: `cash_need:${need.need_id}`,
      kind: "cash_need",
      title: need.description,
      text: `${need.currency} ${need.amount} due from ${need.due_from} to ${need.due_to}; certainty ${need.certainty}.`,
      source_refs: [
        sourceRef(
          "planned_cash_needs.csv",
          { need_id: need.need_id },
          ["amount", "currency", "due_from", "due_to", "certainty"],
          {
            amount: need.amount,
            currency: need.currency,
            due_from: need.due_from,
            due_to: need.due_to,
            certainty: need.certainty,
          }
        ),
      ],
      data: { ...need },
    });
  }

  for (const commitment of repository.getCommitmentsForClient(clientId)) {
    records.push({
      ref_id: `commitment:${commitment.commitment_id}`,
      kind: "commitment",
      title: commitment.fund_name,
      text: `${commitment.currency} ${commitment.uncalled} uncalled; expected ${commitment.expected_call_window}.`,
      source_refs: [
        sourceRef(
          "commitments.csv",
          { commitment_id: commitment.commitment_id },
          ["uncalled", "currency", "expected_call_window"],
          {
            uncalled: commitment.uncalled,
            currency: commitment.currency,
            expected_call_window: commitment.expected_call_window,
          }
        ),
      ],
      data: { ...commitment },
    });
  }

  if (plan.intents.includes("transaction") || plan.needs_history) {
    for (const transaction of repository.getTransactionsForClient(clientId, 30)) {
      records.push({
        ref_id: `transaction:${transaction.transaction_id}`,
        kind: "transaction",
        title: `${transaction.transaction_type}: ${transaction.instrument_id ?? "cash"}`,
        text: `${transaction.trade_date}; amount ${transaction.amount}; ${transaction.narrative}.`,
        source_refs: [
          sourceRef(
            "transactions.csv",
            { transaction_id: transaction.transaction_id },
            ["trade_date", "transaction_type", "amount", "instrument_id", "narrative"],
            {
              trade_date: transaction.trade_date,
              transaction_type: transaction.transaction_type,
              amount: transaction.amount,
              instrument_id: transaction.instrument_id,
              narrative: transaction.narrative,
            }
          ),
        ],
        data: { ...transaction },
      });
    }
  }

  if (plan.needs_notes) {
    for (const note of repository.getRmNotesForClient(clientId).slice(0, 10)) {
      records.push({
        ref_id: `note:${note.note_id}`,
        kind: "note",
        title: `RM note dated ${note.note_date}`,
        text: untrustedDataBlock("rm_note", note.note_id, note.note),
        source_refs: [
          sourceRef(
            "rm_notes.json",
            { note_id: note.note_id },
            ["note_date", "channel", "note"],
            { note_date: note.note_date, channel: note.channel, note: note.note }
          ),
        ],
        data: {
          note_id: note.note_id,
          note_date: note.note_date,
          channel: note.channel,
          untrusted: true,
          content_withheld: containsInstructionInjection(note.note),
        },
      });
    }
  }

  for (const [signalId, narrative] of Object.entries(narratives)) {
    records.push({
      ref_id: `narrative:${signalId}`,
      kind: "narrative",
      title: `Verified narrative for ${signalId}`,
      text: JSON.stringify(narrative),
      source_refs: signals.find((signal) => signal.signal_id === signalId)?.evidence ?? [],
      data: { signal_id: signalId, narrative },
    });
  }

  for (const diversificationPlan of diversificationPlans) {
    const compactPlan = compactDiversificationPlan(diversificationPlan);
    records.push({
      ref_id: `diversification:${diversificationPlan.plan_id}`,
      kind: "diversification_plan",
      title: `Generated portfolio intelligence for ${diversificationPlan.signal_id}`,
      text: [
        `Generated scenario analysis as of ${diversificationPlan.as_of}.`,
        `Recommended actions: ${diversificationPlan.actions
          .map((result) => result.action.title)
          .join("; ")}.`,
        `Includes mandate checks, risk scores, concrete trades, and Central, Hormuz Re-escalation, De-escalation, and Rate Shock Persistence projections.`,
      ].join(" "),
      source_refs: diversificationPlan.source_refs,
      data: compactPlan,
    });
  }

  const ranked = records.map((record) => ({
    ...record,
    score: scoreRecord(record, plan),
  }));
  const selected = budgetRecords(ranked);
  const packWithoutHash = {
    client_id: clientId,
    client_name: client.client_name,
    as_of: asOf,
    query,
    retrieval_plan: plan,
    client_profile: { ...client },
    records: selected,
    data_quality_flags: flags,
  };
  const contextPackHash = createHash("sha256")
    .update(JSON.stringify(packWithoutHash))
    .digest("hex");

  return { ...packWithoutHash, context_pack_hash: contextPackHash };
}
