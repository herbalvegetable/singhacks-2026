"use client";

import { useState } from "react";
import type { DiversificationPlan } from "@/lib/contracts/diversification";
import { ScenarioReturnChart } from "@/components/charts/ScenarioReturnChart";
import { DecisionControls } from "./DecisionControls";
import { EvidenceDisclosure } from "./EvidenceDisclosure";
import { SourceLineageFooter } from "./SourceLineageFooter";

interface DiversificationPanelProps {
  signalId: string;
  clientId: string;
}

interface StreamMessage {
  type: "progress" | "done" | "error";
  message?: string;
  error?: string;
  plan?: DiversificationPlan;
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function DiversificationPanel({
  signalId,
  clientId,
}: DiversificationPanelProps) {
  const [plan, setPlan] = useState<DiversificationPlan | null>(null);
  const [selectedActionId, setSelectedActionId] = useState("action-1");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const generate = async () => {
    if (plan) {
      setExpanded((value) => !value);
      return;
    }
    setLoading(true);
    setExpanded(true);
    setError(null);
    setProgress("Starting objectives-focused retrieval");
    try {
      const response = await fetch(
        `/api/diversify/${encodeURIComponent(signalId)}`,
        { method: "POST" },
      );
      if (!response.ok || !response.body) {
        throw new Error(`Unable to start diversification analysis (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const dataLine = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const message = JSON.parse(dataLine.slice(6)) as StreamMessage;
          if (message.type === "progress" && message.message) {
            setProgress(message.message);
          } else if (message.type === "done" && message.plan) {
            setPlan(message.plan);
            setSelectedActionId(message.plan.actions[0]?.action.action_id ?? "action-1");
          } else if (message.type === "error") {
            throw new Error(message.error || "Diversification analysis failed");
          }
        }
        if (done) break;
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Diversification analysis failed",
      );
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const selected =
    plan?.actions.find((result) => result.action.action_id === selectedActionId) ??
    plan?.actions[0];
  const selectedIndex = plan && selected
    ? plan.actions.findIndex(
        (result) => result.action.action_id === selected.action.action_id,
      )
    : 0;
  const moveAction = (direction: -1 | 1) => {
    if (!plan) return;
    const nextIndex =
      (selectedIndex + direction + plan.actions.length) % plan.actions.length;
    setSelectedActionId(plan.actions[nextIndex].action.action_id);
  };

  return (
    <div className="mt-5 border-t border-white/55 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet">
            Portfolio intelligence
          </p>
          <p className="mt-1 text-sm text-slate/72">
            Compare objective-aligned diversification actions under four market scenarios.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="diversification-button"
        >
          {loading
            ? "Modeling scenarios..."
            : plan && expanded
              ? "Hide Diversification"
              : "Explore Diversification →"}
        </button>
      </div>

      {loading && (
        <div className="diversification-progress" aria-live="polite">
          <div className="diversification-progress-track">
            <span />
          </div>
          <p>{progress}</p>
          <p className="text-xs text-slate/55">
            Retrieving evidence, validating constraints, simulating returns and writing summaries.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-2xl border border-risk-high/30 bg-risk-high/10 p-3 text-sm font-medium text-risk-high">
          {error}
        </div>
      )}

      {plan && expanded && selected && (
        <div className="diversification-results">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-grounded">
                Assumption-driven analysis
              </p>
              <h3 className="mt-1 text-xl font-semibold text-navy">
                Diversification scenario comparison
              </h3>
              <p className="mt-1 text-sm text-slate/65">
                Starting value {currency(plan.baseline_value_usd)} · {plan.horizon_months} months · as of {plan.as_of}
              </p>
            </div>
            <span className="confidence-badge confidence-med">
              {plan.confidence}% confidence
            </span>
          </div>

          <div className="mb-5 grid gap-3 lg:grid-cols-3">
            {plan.actions.map((result, index) => {
              const central = result.projections.find(
                (projection) => projection.scenario_id === "central",
              );
              const active = result.action.action_id === selected.action.action_id;
              return (
                <button
                  type="button"
                  key={result.action.action_id}
                  onClick={() => setSelectedActionId(result.action.action_id)}
                  className={`action-selector ${active ? "is-active" : ""}`}
                >
                  <span className="action-number">{index + 1}</span>
                  <span className="block min-w-0 text-left">
                    <span className="block font-semibold text-navy">
                      {result.action.title}
                    </span>
                    <span className="mt-1 block text-xs text-slate/65">
                      Central median {currency(central?.terminal_p50 ?? 0)} · Risk {result.risk.score}/100
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <ScenarioReturnChart
            plan={plan}
            focusedActionId={selected.action.action_id}
          />

          <div className="action-carousel-controls">
            <button
              type="button"
              onClick={() => moveAction(-1)}
              aria-label="View previous diversification action"
            >
              ←
            </button>
            <div>
              <span>Selected action</span>
              <strong>
                {selectedIndex + 1} of {plan.actions.length}
              </strong>
            </div>
            <button
              type="button"
              onClick={() => moveAction(1)}
              aria-label="View next diversification action"
            >
              →
            </button>
          </div>

          <div className="action-carousel-viewport" aria-live="polite">
          <div
            key={selected.action.action_id}
            className="action-carousel-slide grid gap-5 xl:grid-cols-[1.15fr_.85fr]"
          >
            <section className="scenario-detail-card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet">
                    Selected action
                  </p>
                  <h4 className="mt-1 text-lg font-semibold text-navy">
                    {selected.action.title}
                  </h4>
                  <p className="mt-2 text-sm text-slate">
                    {selected.action.thesis}
                  </p>
                </div>
                <div
                  className="risk-orb"
                  style={{
                    background: `conic-gradient(#8B5CF6 ${selected.risk.score}%, rgba(139,92,246,.14) 0)`,
                  }}
                  aria-label={`Risk score ${selected.risk.score} out of 100`}
                >
                  <span>
                    <strong>{selected.risk.score}</strong>
                    <small>{selected.risk.profile}</small>
                  </span>
                </div>
              </div>

              <div className="mt-5 rounded-2xl bg-white/55 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate/58">
                  AI summary
                </p>
                <p className="mt-2 text-sm leading-6 text-slate">
                  {selected.summary.summary}
                </p>
              </div>

              <DecisionControls
                key={`${plan.plan_id}:${selected.action.action_id}`}
                clientId={clientId}
                targetType="diversification_action"
                targetId={`${plan.plan_id}:${selected.action.action_id}`}
              />

              <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate/58">
                  {selected.action.trades.length > 0
                    ? "Concrete trades"
                    : "Constraint-aware next step"}
                </p>
                <div className="mt-2 space-y-2">
                  {selected.action.trades.length === 0 && (
                    <div className="rounded-2xl border border-risk-mid/20 bg-risk-mid/8 p-4 text-sm text-slate">
                      No safe funded trade pair is available under the current
                      mandate, liquidity, reserved-cash and position constraints.
                      Review the listed caveats before changing a constraint.
                    </div>
                  )}
                  {selected.action.trades.map((trade, index) => (
                    <div
                      key={`${trade.instrument_id}-${trade.direction}-${index}`}
                      className="trade-row"
                    >
                      <span
                        className={`trade-direction ${
                          trade.direction === "buy" ? "is-buy" : "is-sell"
                        }`}
                      >
                        {trade.direction}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-navy">
                          {trade.instrument_name}
                        </span>
                        <span className="block text-xs text-slate/60">
                          {trade.portfolio_id
                            ? `${trade.portfolio_id} · ${trade.rationale}`
                            : trade.rationale}
                        </span>
                      </span>
                      <span className="font-mono font-semibold text-navy">
                        {currency(trade.usd_amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/48 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate/58">
                    Trade-offs
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate">
                    {selected.summary.trade_offs.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl bg-white/48 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate/58">
                    RM talking points
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate">
                    {selected.summary.rm_talking_points.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="scenario-detail-card">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-lagoon">
                Scenario outcomes at month 36
              </p>
              <div className="mt-3 space-y-3">
                {selected.projections.map((projection) => (
                  <div key={projection.scenario_id} className="scenario-stat">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-navy">
                        {projection.scenario_name}
                      </p>
                      <span
                        className={
                          projection.expected_return_pct >= 0
                            ? "text-grounded"
                            : "text-risk-high"
                        }
                      >
                        {projection.expected_return_pct >= 0 ? "+" : ""}
                        {projection.expected_return_pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <span>P10 <strong>{currency(projection.terminal_p10)}</strong></span>
                      <span>P50 <strong>{currency(projection.terminal_p50)}</strong></span>
                      <span>P90 <strong>{currency(projection.terminal_p90)}</strong></span>
                    </div>
                    <p className="mt-2 text-xs text-slate/55">
                      Loss probability {projection.probability_of_loss_pct.toFixed(1)}% · median-path drawdown {projection.max_drawdown_pct.toFixed(1)}%
                    </p>
                    <div className="advanced-stat-grid">
                      <span>
                        Annual return
                        <strong>{projection.annualized_return_pct.toFixed(2)}%</strong>
                      </span>
                      <span>
                        Annual volatility
                        <strong>{projection.annualized_volatility_pct.toFixed(2)}%</strong>
                      </span>
                      <span>
                        Sharpe ratio
                        <strong>{projection.sharpe_ratio.toFixed(2)}</strong>
                      </span>
                      <span>
                        95% VaR
                        <strong>{currency(projection.value_at_risk_95_usd)}</strong>
                      </span>
                      <span>
                        95% CVaR
                        <strong>{currency(projection.conditional_var_95_usd)}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={selected.risk.mandate_compliant ? "compliance-chip is-good" : "compliance-chip is-bad"}>
                  {selected.risk.mandate_compliant ? "Within mandate" : "Mandate breach"}
                </span>
                <span className={selected.risk.suitable_for_client ? "compliance-chip is-good" : "compliance-chip is-bad"}>
                  {selected.risk.suitable_for_client ? "Tolerance aligned" : "Suitability review"}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-xs leading-5 text-slate/72">
                {selected.risk.suitability?.statement && (
                  <p className="rounded-xl bg-white/55 px-3 py-2">
                    {selected.risk.suitability.statement}
                  </p>
                )}
                {selected.risk.mandate_checks?.map((check) => (
                  <p
                    key={`${check.portfolio_id}-${check.asset_class}`}
                    className="rounded-xl bg-white/45 px-3 py-2"
                  >
                    <strong className="text-navy">
                      {check.portfolio_name} · {check.mandate_name}
                    </strong>
                    {" — "}
                    {check.reason}
                  </p>
                ))}
                {!selected.risk.suitability &&
                  selected.risk.reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
              </div>
            </section>
          </div>
          </div>

          <details className="assumption-disclosure">
            <summary>Methodology, capital-market assumptions and caveats</summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {plan.assumptions.map((assumption) => (
                <div key={assumption.asset_class} className="rounded-2xl bg-white/50 p-3">
                  <p className="font-semibold text-navy">{assumption.asset_class}</p>
                  <p className="mt-1 text-xs text-slate">
                    Expected return {assumption.expected_return_pct.toFixed(2)}% · Volatility {assumption.volatility_pct.toFixed(2)}%
                  </p>
                  <p className="mt-2 text-xs text-slate/58">{assumption.rationale}</p>
                </div>
              ))}
            </div>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate/65">
              {plan.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
            <p className="mt-3 font-mono text-[11px] text-slate/45">
              Assumption set {plan.assumption_set_version} · context {plan.context_pack_hash.slice(0, 16)}
            </p>
          </details>
          <div className="mt-4 space-y-2 rounded-2xl border border-white/55 bg-white/35 p-4">
            <SourceLineageFooter sources={plan.source_refs} />
            <EvidenceDisclosure
              sources={plan.source_refs}
              label="Review recommendation evidence"
            />
          </div>
        </div>
      )}
    </div>
  );
}
