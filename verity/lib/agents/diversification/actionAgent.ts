import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  ActionProposal,
  ProposedAction,
  type ProposedAction as ProposedActionType,
} from "../../contracts/diversification";
import {
  envelopeForPrompt,
  type FeasibilityEnvelope,
} from "../../compute/diversification/feasibility";
import type { DiversificationContext } from "./retrieval";
import {
  OPENAI_REQUEST_OPTIONS,
  requireAgentsEnabled,
} from "../runtime";
import { minimizeModelPayload } from "../privacy";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "agents-disabled",
  ...OPENAI_REQUEST_OPTIONS,
});

const systemPrompt = `You are Verity's portfolio action designer for a Relationship Manager.

Propose exactly three distinct, concrete diversification actions. Each action is a hypothetical for discussion, not an instruction to trade.

RULES:
1. Ground every action in the supplied client objectives, signal, holdings and mandate envelope.
2. Use only permitted portfolio/instrument pairs. Every trade must include portfolio_id. Do not invent securities, prices, returns or client facts.
3. Each action must include at least one buy and one sell. Use approximate USD amounts; a deterministic validator will repair sizing.
4. Respect liquidity restrictions, reserved cash, each managed portfolio's own mandate min/max bands and single-position limits. Custody portfolios are not mandate-tested.
5. Make the three approaches meaningfully different (for example concentration reduction, mandate rebalance, and defensive resilience).
6. Target allocations must contain each of the six supplied asset classes exactly once.
7. Do not estimate returns, risk scores or scenario outcomes.
8. State uncertainty in caveats.`;

export async function proposeDiversificationActions(
  context: DiversificationContext,
): Promise<ProposedActionType[]> {
  requireAgentsEnabled();
  const completion = await openai.chat.completions.parse({
    model: "gpt-4o",
    temperature: 0.2,
    response_format: zodResponseFormat(ActionProposal, "diversification_actions"),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify(
          {
            client_and_signal_context: minimizeModelPayload(context.ragContext),
            feasibility_envelope: envelopeForPrompt(context.envelope),
          },
          null,
          2,
        ),
      },
    ],
    max_completion_tokens: 2200,
  });
  const parsed = completion.choices[0].message.parsed;
  if (!parsed) throw new Error("Failed to parse diversification actions");
  return parsed.actions.map((action, index) =>
    ProposedAction.parse({
      ...action,
      action_id: `action-${index + 1}`,
    }),
  );
}

export function fallbackAction(
  original: ProposedActionType,
  envelope: FeasibilityEnvelope,
  attempt: number,
): ProposedActionType {
  const valueByInstrument = envelope.holdings.reduce<Record<string, number>>(
    (totals, holding) => {
      totals[holding.instrument_id] =
        (totals[holding.instrument_id] ?? 0) + holding.market_value_usd;
      return totals;
    },
    {},
  );
  const cashValue = envelope.holdings
    .filter((holding) => holding.asset_class === "Cash and Equivalents")
    .reduce((sum, holding) => sum + holding.market_value_usd, 0);
  const sellCandidates = envelope.holdings
    .filter(
      (holding) =>
        holding.liquidity_tier !== "Illiquid" &&
        valueByInstrument[holding.instrument_id] > 1 &&
        (holding.asset_class !== "Cash and Equivalents" ||
          cashValue > envelope.reservedCashUsd + 1),
    )
    .filter(
      (holding, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.portfolio_id === holding.portfolio_id &&
            candidate.instrument_id === holding.instrument_id,
        ) === index,
    )
    .sort((a, b) => b.market_value_usd - a.market_value_usd);
  const sell = sellCandidates[attempt % sellCandidates.length];
  const instrumentById = new Map(
    envelope.instruments.map((instrument) => [
      instrument.instrument_id,
      instrument,
    ]),
  );
  const availableBuyCandidates = envelope.holdings
    .filter(
      (holding) =>
        holding.instrument_id !== sell?.instrument_id &&
        (instrumentById.get(holding.instrument_id)?.concentration_limit_applies !== "Y" ||
          (() => {
            const portfolio = envelope.portfolios.find(
              (candidate) => candidate.portfolio_id === holding.portfolio_id,
            );
            const limits = portfolio
              ? envelope.mandates.filter(
                  (mandate) => mandate.mandate_code === portfolio.mandate_code,
                )
              : [];
            const maxPct = limits.length
              ? Math.min(...limits.map((mandate) => mandate.max_single_position_pct))
              : 100;
            const portfolioValue = envelope.holdings
              .filter((item) => item.portfolio_id === holding.portfolio_id)
              .reduce((sum, item) => sum + item.market_value_usd, 0);
            return holding.market_value_usd < (maxPct / 100) * portfolioValue - 1;
          })()),
    )
    .filter(
      (holding, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.portfolio_id === holding.portfolio_id &&
            candidate.instrument_id === holding.instrument_id,
        ) === index,
    )
    .sort((a, b) => a.market_value_usd - b.market_value_usd);
  const samePortfolioCandidates = availableBuyCandidates.filter(
    (holding) => holding.portfolio_id === sell?.portfolio_id,
  );
  const sameClassCandidates = samePortfolioCandidates.filter(
    (holding) => holding.asset_class === sell?.asset_class,
  );
  const buyCandidates =
    sameClassCandidates.length > 0
      ? sameClassCandidates
      : samePortfolioCandidates;
  const buy =
    buyCandidates[attempt % buyCandidates.length];
  if (!sell || !buy) throw new Error("Portfolio does not contain a feasible buy/sell pair");
  const amount = Math.min(
    valueByInstrument[sell.instrument_id] * 0.2,
    envelope.baselineValueUsd * (0.02 + (attempt % 3) * 0.01),
  );
  return {
    ...original,
    trades: [
      {
        portfolio_id: sell.portfolio_id,
        instrument_id: sell.instrument_id,
        instrument_name: sell.instrument_name,
        direction: "sell",
        usd_amount: amount,
        rationale: "Reduce the largest liquid exposure within the selected approach.",
      },
      {
        portfolio_id: buy.portfolio_id,
        instrument_id: buy.instrument_id,
        instrument_name: buy.instrument_name,
        direction: "buy",
        usd_amount: amount,
        rationale: "Reallocate to an existing, smaller portfolio exposure.",
      },
    ],
    caveats: [
      ...original.caveats,
      "Trade sizing was repaired deterministically because the generated sizing was infeasible.",
    ],
  };
}

export function deterministicActionTemplates(
  envelope: FeasibilityEnvelope,
): ProposedActionType[] {
  const objective = envelope.client.objectives || "Improve portfolio resilience";
  const templates = [
    {
      title: "Reduce the largest liquid concentration",
      thesis:
        "Reallocate a measured portion of the largest sellable exposure toward a smaller existing holding.",
    },
    {
      title: "Rebalance toward the mandate mix",
      thesis:
        "Move a limited amount between existing holdings while preserving mandate and liquidity constraints.",
    },
    {
      title: "Build defensive portfolio resilience",
      thesis:
        "Use the most feasible existing pair to reduce concentration without consuming reserved liquidity.",
    },
  ];
  return templates.map((template, index) => ({
    action_id: `action-${index + 1}`,
    title: template.title,
    thesis: template.thesis,
    objective_alignment: [objective],
    trades: [],
    target_allocations: envelope.currentAllocations,
    caveats: [
      "This action template was generated deterministically because the model proposal was unavailable.",
    ],
  }));
}
