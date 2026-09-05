"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface PortfolioAllocationSlice {
  assetClass: string;
  valueUsd: number;
}

interface PortfolioAllocationPieProps {
  data: PortfolioAllocationSlice[];
}

const COLORS = [
  "#0EA5E9",
  "#8B5CF6",
  "#00B894",
  "#F6C453",
  "#FF4D6D",
  "#27DDEB",
];

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function PortfolioAllocationPie({
  data,
}: PortfolioAllocationPieProps) {
  const total = data.reduce((sum, item) => sum + item.valueUsd, 0);
  const chartData = [...data]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .map((item) => ({
      name: item.assetClass,
      value: item.valueUsd,
      percentage: total > 0 ? (item.valueUsd / total) * 100 : 0,
    }));

  if (chartData.length === 0) {
    return (
      <p className="rounded-2xl bg-white/40 p-4 text-center text-xs text-slate/55">
        No current allocation data available.
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-white/65 pt-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate/58">
        Current asset allocation
      </p>
      <div className="h-56 w-full" aria-label="Current portfolio asset allocation pie chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="43%"
              outerRadius="78%"
              paddingAngle={2}
              stroke="rgba(255,255,255,.9)"
              strokeWidth={2}
              isAnimationActive
            >
              {chartData.map((item, index) => (
                <Cell
                  key={item.name}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, item) => [
                `${currency(Number(value))} · ${Number(
                  item.payload.percentage,
                ).toFixed(1)}%`,
                String(name),
              ]}
              contentStyle={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.9)",
                background: "rgba(255,255,255,.9)",
                boxShadow: "0 14px 35px rgba(27,58,111,.16)",
                backdropFilter: "blur(18px)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {chartData.map((item, index) => (
          <div
            key={item.name}
            className="flex items-center justify-between gap-2 rounded-xl bg-white/38 px-2.5 py-2 text-xs"
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
