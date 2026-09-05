"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DiversificationPlan,
  ScenarioProjection,
} from "@/lib/contracts/diversification";

interface ScenarioReturnChartProps {
  plan: DiversificationPlan;
  focusedActionId: string;
}

type CompareMode = "actions" | "scenarios";
type ValueMode = "growth" | "value";

const COLORS = ["#0EA5E9", "#8B5CF6", "#00B894", "#F59E0B", "#FF4D6D"];

function compactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function pointValue(
  projection: ScenarioProjection,
  index: number,
  mode: ValueMode,
): number {
  const point = projection.points[index];
  return mode === "growth" ? point.cumulative_return_pct : point.p50_value;
}

export function ScenarioReturnChart({
  plan,
  focusedActionId,
}: ScenarioReturnChartProps) {
  const scenarioOptions = plan.baseline_projections.map((projection) => ({
    id: projection.scenario_id,
    name: projection.scenario_name,
  }));
  const [scenarioId, setScenarioId] = useState(scenarioOptions[0]?.id ?? "central");
  const [compareMode, setCompareMode] = useState<CompareMode>("actions");
  const [valueMode, setValueMode] = useState<ValueMode>("growth");
  const focusedAction = plan.actions.find(
    (result) => result.action.action_id === focusedActionId,
  ) ?? plan.actions[0];

  const { chartData, series, domain, terminalDeltas } = useMemo(() => {
    const selectedBaseline =
      plan.baseline_projections.find(
        (projection) => projection.scenario_id === scenarioId,
      ) ?? plan.baseline_projections[0];
    const lines =
      compareMode === "actions"
        ? [
            {
              key: "hold-current",
              name: "Hold Current",
              projection: selectedBaseline,
              color: "#64748B",
              dashed: true,
            },
            ...plan.actions.map((result, index) => ({
              key: result.action.action_id,
              name: result.action.title,
              projection:
                result.projections.find(
                  (projection) => projection.scenario_id === scenarioId,
                ) ?? result.projections[0],
              color: COLORS[index],
              dashed: false,
            })),
          ]
        : [
            {
              key: "hold-current",
              name: "Hold Current · Central",
              projection:
                plan.baseline_projections.find(
                  (projection) => projection.scenario_id === "central",
                ) ?? plan.baseline_projections[0],
              color: "#64748B",
              dashed: true,
            },
            ...focusedAction.projections.map((projection, index) => ({
              key: `scenario-${projection.scenario_id}`,
              name: projection.scenario_name,
              projection,
              color: COLORS[index],
              dashed: false,
            })),
          ];
    const basePoints = lines[0]?.projection.points ?? [];
    const rows = basePoints.map((point, index) => {
      const row: Record<string, number | number[]> = { month: point.month };
      for (const line of lines) {
        row[line.key] = pointValue(line.projection, index, valueMode);
      }
      return row;
    });
    const scalarValues = rows.flatMap((row) =>
      lines.map((line) => Number(row[line.key] ?? 0)),
    );
    const minimum = Math.min(...scalarValues);
    const maximum = Math.max(...scalarValues);
    const padding = Math.max(
      valueMode === "growth" ? 0.5 : plan.baseline_value_usd * 0.005,
      (maximum - minimum) * 0.12,
    );
    const holdTerminal = Number(rows.at(-1)?.["hold-current"] ?? 0);
    return {
      chartData: rows,
      series: lines,
      domain: [minimum - padding, maximum + padding] as [number, number],
      terminalDeltas: lines.slice(1).map((line) => ({
        key: line.key,
        name: line.name,
        delta: Number(rows.at(-1)?.[line.key] ?? 0) - holdTerminal,
        color: line.color,
      })),
    };
  }, [
    compareMode,
    focusedAction,
    plan.actions,
    plan.baseline_projections,
    plan.baseline_value_usd,
    scenarioId,
    valueMode,
  ]);

  const formatValue = (value: number) =>
    valueMode === "growth" ? `${value.toFixed(1)}%` : compactCurrency(value);

  return (
    <section className="scenario-chart-card" aria-label="Portfolio return comparison">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-lagoon">
            36-month statistically modeled projection
          </p>
          <h4 className="mt-1 font-semibold text-navy">
            {compareMode === "actions"
              ? "Growth comparison by portfolio action"
              : `Market scenarios · ${focusedAction.action.title}`}
          </h4>
          <p className="mt-1 text-xs text-slate/65">
            Quarterly rebalanced, correlated Monte Carlo paths with common random numbers for fair comparisons.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCompareMode("actions")}
            className={`scenario-toggle ${compareMode === "actions" ? "is-active" : ""}`}
          >
            Compare actions
          </button>
          <button
            type="button"
            onClick={() => setCompareMode("scenarios")}
            className={`scenario-toggle ${compareMode === "scenarios" ? "is-active" : ""}`}
          >
            Compare scenarios
          </button>
          <button
            type="button"
            onClick={() => setValueMode(valueMode === "growth" ? "value" : "growth")}
            className="scenario-toggle"
          >
            Show {valueMode === "growth" ? "value" : "growth %"}
          </button>
        </div>
      </div>

      {compareMode === "actions" && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Choose market scenario">
          {scenarioOptions.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setScenarioId(scenario.id)}
              className={`scenario-toggle ${
                scenarioId === scenario.id ? "is-active" : ""
              }`}
            >
              {scenario.name}
            </button>
          ))}
        </div>
      )}

      <div className="h-[410px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 18, left: 12, bottom: 8 }}>
            <CartesianGrid stroke="rgba(27,58,111,0.10)" strokeDasharray="4 6" />
            <ReferenceLine
              y={valueMode === "growth" ? 0 : plan.baseline_value_usd}
              stroke="rgba(27,58,111,.25)"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="month"
              tickFormatter={(month) => `${month}m`}
              stroke="rgba(27,58,111,0.55)"
              tick={{ fontSize: 12 }}
            />
            <YAxis
              domain={domain}
              tickFormatter={(value) => formatValue(Number(value))}
              width={76}
              stroke="rgba(27,58,111,0.55)"
              tick={{ fontSize: 12 }}
              allowDataOverflow
            />
            <Tooltip
              formatter={(value) =>
                Array.isArray(value)
                  ? value.map((item) => formatValue(Number(item))).join(" – ")
                  : formatValue(Number(value))
              }
              labelFormatter={(month) => `Month ${month}`}
              contentStyle={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,.85)",
                background: "rgba(255,255,255,.9)",
                backdropFilter: "blur(18px)",
              }}
            />
            <Legend />
            {series.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.name}
                stroke={line.color}
                strokeWidth={
                  line.key === focusedActionId ||
                  line.key === `scenario-${scenarioId}`
                    ? 3.5
                    : 2.25
                }
                strokeDasharray={line.dashed ? "5 5" : undefined}
                dot={false}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {terminalDeltas.map((item) => (
          <span key={item.key} className="growth-delta-chip">
            <i style={{ background: item.color }} />
            {item.name}: {item.delta >= 0 ? "+" : ""}
            {valueMode === "growth"
              ? `${item.delta.toFixed(2)}pp vs hold`
              : `${compactCurrency(item.delta)} vs hold`}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate/58">
        The vertical axis auto-zooms to reveal allocation differences. Estimates use explicit assumptions and observed stress shocks; they are not forecasts.
      </p>
    </section>
  );
}
