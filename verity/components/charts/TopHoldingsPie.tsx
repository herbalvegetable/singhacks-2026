"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface TopHoldingSlice {
  instrumentId: string;
  instrumentName: string;
  valueUsd: number;
}

interface TopHoldingsPieProps {
  holdings: TopHoldingSlice[];
}

const COLORS = [
  "#0EA5E9",
  "#8B5CF6",
  "#00B894",
  "#F6C453",
  "#FF4D6D",
  "#27DDEB",
  "#6366F1",
  "#F59E0B",
  "#14B8A6",
  "#EC4899",
  "#3B82F6",
  "#84CC16",
  "#A855F7",
  "#FB7185",
  "#22D3EE",
  "#94A3B8",
];

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function TopHoldingsPie({ holdings }: TopHoldingsPieProps) {
  const aggregated = new Map<
    string,
    { id: string; name: string; value: number }
  >();
  for (const holding of holdings) {
    const current = aggregated.get(holding.instrumentId) ?? {
      id: holding.instrumentId,
      name: holding.instrumentName,
      value: 0,
    };
    current.value += holding.valueUsd;
    aggregated.set(holding.instrumentId, current);
  }

  const total = [...aggregated.values()].reduce((sum, item) => sum + item.value, 0);
  const chartData = [...aggregated.values()]
    .sort((left, right) => right.value - left.value)
    .map((item) => ({
      ...item,
      percentage: total > 0 ? (item.value / total) * 100 : 0,
    }));

  if (chartData.length === 0) {
    return (
      <p className="mb-4 rounded-2xl bg-white/40 p-4 text-center text-xs text-slate/55">
        No current holding data available.
      </p>
    );
  }

  return (
    <div className="mb-5 border-b border-white/65 pb-5">
      <div
        className="h-72 w-full"
        aria-label="Current holdings pie chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="34%"
              outerRadius="76%"
              paddingAngle={chartData.length > 20 ? 0.4 : 1.2}
              stroke="rgba(255,255,255,.92)"
              strokeWidth={1}
            >
              {chartData.map((item, index) => (
                <Cell
                  key={item.id}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, item) => {
                const slice = item.payload as { percentage: number };
                return [
                  `${currency(Number(value))} · ${slice.percentage.toFixed(1)}%`,
                  String(name),
                ];
              }}
              contentStyle={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.9)",
                background: "rgba(255,255,255,.92)",
                boxShadow: "0 14px 35px rgba(27,58,111,.16)",
                backdropFilter: "blur(18px)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 copilot-scroll">
        {chartData.map((item, index) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 rounded-xl bg-white/38 px-2.5 py-2 text-xs"
            title={`${item.name}: ${currency(item.value)} (${item.percentage.toFixed(1)}%)`}
          >
            <span className="flex min-w-0 items-center gap-2 text-slate">
              <i
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: COLORS[index % COLORS.length] }}
              />
              <span className="truncate">{item.name}</span>
            </span>
            <strong className="font-mono text-navy">
              {item.percentage.toFixed(1)}%
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
