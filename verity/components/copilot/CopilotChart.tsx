"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CopilotChart as CopilotChartSpec } from "@/lib/contracts/chat";

interface CopilotChartProps {
  chart: CopilotChartSpec;
}

const COLORS = ["#0EA5E9", "#8B5CF6", "#00B894", "#F6C453"];

function formatValue(value: number, unit: CopilotChartSpec["unit"]): string {
  if (unit === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "score") return `${value.toFixed(0)}/100`;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function truncate(value: string, max = 16): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function CopilotChart({ chart }: CopilotChartProps) {
  const labels = [
    ...new Set(
      chart.series.flatMap((series) =>
        series.points.map((point) => point.label),
      ),
    ),
  ];
  const data = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    for (const series of chart.series) {
      const point = series.points.find((candidate) => candidate.label === label);
      if (point) row[series.name] = point.value;
    }
    return row;
  });
  const tooltipFormatter = (value: unknown, name: unknown) => [
    formatValue(Number(value), chart.unit),
    String(name),
  ];

  return (
    <figure className="mt-3 overflow-hidden rounded-2xl border border-white/65 bg-white/48 p-3 shadow-inner">
      <figcaption>
        <p className="font-semibold text-navy">{chart.title}</p>
        {chart.subtitle && (
          <p className="mt-1 text-[10px] leading-relaxed text-slate/55">
            {chart.subtitle}
          </p>
        )}
      </figcaption>

      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "pie" ? (
            <PieChart>
              <Pie
                data={chart.series[0].points}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="45%"
                innerRadius="35%"
                outerRadius="67%"
                paddingAngle={2}
                stroke="rgba(255,255,255,.9)"
                strokeWidth={2}
              >
                {chart.series[0].points.map((point, index) => (
                  <Cell
                    key={point.label}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={tooltipFormatter} />
              <Legend
                formatter={(value) => (
                  <span className="text-[10px] text-slate">
                    {truncate(String(value), 18)}
                  </span>
                )}
              />
            </PieChart>
          ) : chart.type === "line" ? (
            <LineChart
              data={data}
              margin={{ top: 5, right: 8, left: -20, bottom: 25 }}
            >
              <CartesianGrid
                stroke="rgba(27,58,111,.09)"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9 }}
                tickFormatter={(value) => truncate(String(value), 10)}
                angle={-25}
                textAnchor="end"
                height={45}
              />
              <YAxis
                tick={{ fontSize: 9 }}
                tickFormatter={(value) => formatValue(Number(value), chart.unit)}
                width={58}
              />
              <Tooltip formatter={tooltipFormatter} />
              {chart.series.map((series, index) => (
                <Line
                  key={series.name}
                  type="monotone"
                  dataKey={series.name}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : chart.type === "histogram" ? (
            <BarChart
              data={data}
              margin={{ top: 5, right: 8, left: -20, bottom: 35 }}
            >
              <CartesianGrid
                stroke="rgba(27,58,111,.09)"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 8 }}
                angle={-25}
                textAnchor="end"
                height={58}
              />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} width={40} />
              <Tooltip formatter={tooltipFormatter} />
              <Bar
                dataKey={chart.series[0].name}
                fill={COLORS[0]}
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          ) : (
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 5, right: 8, left: 5, bottom: 5 }}
            >
              <CartesianGrid
                stroke="rgba(27,58,111,.09)"
                strokeDasharray="3 5"
              />
              <XAxis
                type="number"
                tick={{ fontSize: 9 }}
                tickFormatter={(value) => formatValue(Number(value), chart.unit)}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 9 }}
                tickFormatter={(value) => truncate(String(value), 14)}
                width={90}
              />
              <Tooltip formatter={tooltipFormatter} />
              {chart.series.map((series, index) => (
                <Bar
                  key={series.name}
                  dataKey={series.name}
                  fill={COLORS[index % COLORS.length]}
                  radius={[0, 5, 5, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <details className="mt-2 text-[10px] text-slate/50">
        <summary className="font-semibold text-slate/65">
          Why this visualization
        </summary>
        <p className="mt-1 leading-relaxed">{chart.decision_reason}</p>
        <p className="mt-1 font-mono">
          Grounded in {chart.source_ref_ids.length} retrieved source record
          {chart.source_ref_ids.length === 1 ? "" : "s"}.
        </p>
      </details>
    </figure>
  );
}
