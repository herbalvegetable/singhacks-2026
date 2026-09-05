import type {
  ContextPack,
  CopilotAnswer,
  CopilotChart,
  CopilotChartType,
} from "../../contracts/chat";

export interface ChartCandidate {
  candidateId: string;
  title: string;
  subtitle: string | null;
  xLabel: string;
  yLabel: string;
  unit: CopilotChart["unit"];
  supportedTypes: CopilotChartType[];
  series: CopilotChart["series"];
}

export interface VisualizationDecision {
  shouldDisplay: boolean;
  candidateId: string | null;
  chartType: CopilotChartType | null;
  title: string | null;
  reason: string;
}

interface Aggregate {
  value: number;
  refs: Set<string>;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function compactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function holdingRecords(pack: ContextPack) {
  return pack.records.filter((record) => record.kind === "holding");
}

function allocationCandidate(pack: ContextPack): ChartCandidate | null {
  const groups = new Map<string, Aggregate>();
  for (const record of holdingRecords(pack)) {
    const assetClass = String(record.data.asset_class ?? "Unknown");
    const marketValue = Number(record.data.market_value_usd);
    if (!Number.isFinite(marketValue) || marketValue < 0) continue;
    const current = groups.get(assetClass) ?? { value: 0, refs: new Set<string>() };
    current.value += marketValue;
    current.refs.add(record.ref_id);
    groups.set(assetClass, current);
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.value, 0);
  if (groups.size < 2 || total <= 0) return null;
  return {
    candidateId: "portfolio-allocation",
    title: "Current portfolio allocation",
    subtitle: `Client-level allocation as of ${pack.as_of}; total retrieved value ${compactCurrency(total)}`,
    xLabel: "Asset class",
    yLabel: "Portfolio share",
    unit: "percent",
    supportedTypes: ["pie", "bar"],
    series: [
      {
        name: "Allocation",
        points: [...groups.entries()]
          .sort(([, left], [, right]) => right.value - left.value)
          .map(([label, group]) => ({
            label,
            value: Number(((group.value / total) * 100).toFixed(2)),
            source_ref_ids: [...group.refs],
          })),
      },
    ],
  };
}

function holdingsCandidate(pack: ContextPack): ChartCandidate | null {
  const points = holdingRecords(pack)
    .map((record) => ({
      label: record.title,
      value: Number(record.data.market_value_usd),
      source_ref_ids: [record.ref_id],
    }))
    .filter((point) => Number.isFinite(point.value))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10);
  if (points.length < 2) return null;
  return {
    candidateId: "largest-holdings",
    title: "Largest current holdings",
    subtitle: `Top retrieved positions as of ${pack.as_of}`,
    xLabel: "Holding",
    yLabel: "Market value",
    unit: "USD",
    supportedTypes: ["bar"],
    series: [{ name: "Market value", points }],
  };
}

function signalCandidate(pack: ContextPack): ChartCandidate | null {
  const points = pack.records
    .filter((record) => record.kind === "signal")
    .map((record) => ({
      label: record.title,
      value: Number(record.data.urgency_score),
      source_ref_ids: [record.ref_id],
    }))
    .filter((point) => Number.isFinite(point.value))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);
  if (points.length < 2) return null;
  return {
    candidateId: "signal-urgency",
    title: "Signal urgency comparison",
    subtitle: "Deterministic urgency scores from active client signals",
    xLabel: "Signal",
    yLabel: "Urgency score",
    unit: "score",
    supportedTypes: ["bar"],
    series: [{ name: "Urgency", points }],
  };
}

function facilityCandidate(pack: ContextPack): ChartCandidate | null {
  const series = pack.records
    .filter((record) => record.kind === "facility")
    .map((record) => {
      const data = record.data as {
        facility?: { facility_id?: string };
        snapshots?: Array<{ snapshot_date?: string; ltv_pct?: number }>;
      };
      return {
        name: data.facility?.facility_id ?? record.title,
        points: (data.snapshots ?? [])
          .map((snapshot) => ({
            label: String(snapshot.snapshot_date ?? ""),
            value: Number(snapshot.ltv_pct),
            source_ref_ids: [record.ref_id],
          }))
          .filter(
            (point) => point.label.length > 0 && Number.isFinite(point.value),
          ),
      };
    })
    .filter((item) => item.points.length > 1);
  if (series.length === 0) return null;
  return {
    candidateId: "facility-ltv-history",
    title: "Credit facility LTV history",
    subtitle: "Loan-to-value ratio across available snapshots",
    xLabel: "Snapshot date",
    yLabel: "LTV",
    unit: "percent",
    supportedTypes: ["line"],
    series: series.slice(0, 4),
  };
}

function cashNeedCandidate(pack: ContextPack): ChartCandidate | null {
  const points = pack.records
    .filter(
      (record) =>
        record.kind === "cash_need" &&
        String(record.data.currency ?? "").toUpperCase() === "USD",
    )
    .map((record) => ({
      label: String(record.data.due_from ?? record.title),
      value: Number(record.data.amount),
      source_ref_ids: [record.ref_id],
    }))
    .filter((point) => Number.isFinite(point.value))
    .sort((left, right) => left.label.localeCompare(right.label));
  if (points.length === 0) return null;
  return {
    candidateId: "cash-needs",
    title: "Planned cash needs",
    subtitle: "USD-denominated known amounts ordered by earliest due date",
    xLabel: "Due date",
    yLabel: "Recorded amount",
    unit: "USD",
    supportedTypes: ["bar", "line"],
    series: [{ name: "Cash need", points }],
  };
}

function transactionCandidate(pack: ContextPack): ChartCandidate | null {
  const points = pack.records
    .filter(
      (record) =>
        record.kind === "transaction" &&
        String(record.data.currency ?? "").toUpperCase() === "USD",
    )
    .map((record) => ({
      label: String(record.data.trade_date ?? ""),
      value: Number(record.data.amount),
      source_ref_ids: [record.ref_id],
    }))
    .filter((point) => point.label.length > 0 && Number.isFinite(point.value))
    .sort((left, right) => left.label.localeCompare(right.label));
  if (points.length < 2) return null;
  return {
    candidateId: "transaction-history",
    title: "Recent transaction amounts",
    subtitle: "USD-denominated transaction amounts in chronological order",
    xLabel: "Trade date",
    yLabel: "Amount",
    unit: "USD",
    supportedTypes: ["line", "bar"],
    series: [{ name: "Transaction amount", points }],
  };
}

function holdingsHistogramCandidate(pack: ContextPack): ChartCandidate | null {
  const holdings = holdingRecords(pack)
    .map((record) => ({
      value: Number(record.data.market_value_usd),
      refId: record.ref_id,
    }))
    .filter((item) => Number.isFinite(item.value) && item.value >= 0);
  if (holdings.length < 4) return null;
  const minimum = Math.min(...holdings.map((item) => item.value));
  const maximum = Math.max(...holdings.map((item) => item.value));
  const binCount = Math.min(5, Math.ceil(Math.sqrt(holdings.length)));
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: minimum + index * width,
    upper: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    refs: [] as string[],
  }));
  for (const holding of holdings) {
    const index =
      maximum === minimum
        ? 0
        : Math.min(binCount - 1, Math.floor((holding.value - minimum) / width));
    bins[index].refs.push(holding.refId);
  }
  return {
    candidateId: "holding-size-distribution",
    title: "Holding size distribution",
    subtitle: `${holdings.length} retrieved positions grouped into equal-width market-value ranges`,
    xLabel: "Market-value range",
    yLabel: "Number of holdings",
    unit: "count",
    supportedTypes: ["histogram"],
    series: [
      {
        name: "Holdings",
        points: bins.map((bin) => ({
          label: `${compactCurrency(bin.lower)}–${compactCurrency(bin.upper)}`,
          value: bin.refs.length,
          source_ref_ids: bin.refs,
        })),
      },
    ],
  };
}

interface CompactScenario {
  scenario_id?: string;
  milestones?: Array<{ month?: number; p50_value?: number }>;
}

interface CompactRecommendedAction {
  action_id?: string;
  title?: string;
  risk?: { score?: number };
  scenarios?: CompactScenario[];
}

interface CompactDiversificationData {
  signal_id?: string;
  hold_current_scenarios?: CompactScenario[];
  recommended_actions?: CompactRecommendedAction[];
}

function generatedScenarioCandidate(pack: ContextPack): ChartCandidate | null {
  const record = pack.records.find(
    (candidate) => candidate.kind === "diversification_plan",
  );
  if (!record) return null;
  const data = record.data as CompactDiversificationData;
  const current = data.hold_current_scenarios?.find(
    (scenario) => scenario.scenario_id === "central",
  );
  const currentPoints = (current?.milestones ?? [])
    .map((point) => ({
      label: `${Number(point.month)} months`,
      value: Number(point.p50_value),
      source_ref_ids: [record.ref_id],
    }))
    .filter((point) => Number.isFinite(point.value));
  if (currentPoints.length === 0) return null;
  const series: CopilotChart["series"] = [
    { name: "Hold Current", points: currentPoints },
  ];
  for (const action of data.recommended_actions ?? []) {
    const central = action.scenarios?.find(
      (scenario) => scenario.scenario_id === "central",
    );
    const points = (central?.milestones ?? [])
      .map((point) => ({
        label: `${Number(point.month)} months`,
        value: Number(point.p50_value),
        source_ref_ids: [record.ref_id],
      }))
      .filter((point) => Number.isFinite(point.value));
    if (points.length > 0) {
      series.push({
        name: action.title ?? action.action_id ?? "Recommended action",
        points,
      });
    }
  }
  return {
    candidateId: "generated-central-projections",
    title: "Generated action projections",
    subtitle:
      "Central-scenario median portfolio values from the latest generated portfolio intelligence",
    xLabel: "Projection horizon",
    yLabel: "Median portfolio value",
    unit: "USD",
    supportedTypes: ["line"],
    series: series.slice(0, 4),
  };
}

function generatedRiskCandidate(pack: ContextPack): ChartCandidate | null {
  const record = pack.records.find(
    (candidate) => candidate.kind === "diversification_plan",
  );
  if (!record) return null;
  const data = record.data as CompactDiversificationData;
  const points = (data.recommended_actions ?? [])
    .map((action) => ({
      label: action.title ?? action.action_id ?? "Recommended action",
      value: Number(action.risk?.score),
      source_ref_ids: [record.ref_id],
    }))
    .filter((point) => Number.isFinite(point.value));
  if (points.length === 0) return null;
  return {
    candidateId: "generated-action-risk",
    title: "Generated action risk comparison",
    subtitle: "Deterministic risk scores from the latest portfolio intelligence",
    xLabel: "Recommended action",
    yLabel: "Risk score",
    unit: "score",
    supportedTypes: ["bar"],
    series: [{ name: "Risk score", points }],
  };
}

export function buildVisualizationCandidates(
  pack: ContextPack,
): ChartCandidate[] {
  return [
    allocationCandidate(pack),
    holdingsCandidate(pack),
    signalCandidate(pack),
    facilityCandidate(pack),
    cashNeedCandidate(pack),
    transactionCandidate(pack),
    holdingsHistogramCandidate(pack),
    generatedScenarioCandidate(pack),
    generatedRiskCandidate(pack),
  ].filter((candidate): candidate is ChartCandidate => candidate !== null);
}

export function shouldConsiderVisualization(
  query: string,
  answer: CopilotAnswer,
  candidates: ChartCandidate[],
): boolean {
  if (candidates.length === 0 || answer.refused) return false;
  const explicitlyRequested =
    /\b(chart|graph|plot|visuali[sz]e|pie|histogram|bar chart|line chart|allocation breakdown)\b/i.test(
      query,
    );
  const numericClaims = answer.answer.match(
    /(?:[$€£]\s*)?\d[\d,.]*(?:\s*%|\s*(?:million|billion|m|k))?/gi,
  );
  const quantitativeTopic =
    /\b(allocation|exposure|holding|trend|history|distribution|compare|amount|value|percentage|ltv|urgency)\b/i.test(
      `${query} ${answer.answer}`,
    );
  return explicitlyRequested || (quantitativeTopic && (numericClaims?.length ?? 0) >= 2);
}

export function materializeVisualization(
  pack: ContextPack,
  candidates: ChartCandidate[],
  decision: VisualizationDecision,
): CopilotChart | null {
  if (!decision.shouldDisplay || !decision.candidateId || !decision.chartType) {
    return null;
  }
  const candidate = candidates.find(
    (item) => item.candidateId === decision.candidateId,
  );
  if (!candidate) return null;
  const chartType = candidate.supportedTypes.includes(decision.chartType)
    ? decision.chartType
    : candidate.supportedTypes[0];
  const validRefs = new Set(pack.records.map((record) => record.ref_id));
  const sourceRefIds = unique(
    candidate.series.flatMap((series) =>
      series.points.flatMap((point) =>
        point.source_ref_ids.filter((refId) => validRefs.has(refId)),
      ),
    ),
  );
  if (sourceRefIds.length === 0) return null;
  return {
    chart_id: `chart-${candidate.candidateId}`,
    type: chartType,
    title: decision.title?.trim() || candidate.title,
    subtitle: candidate.subtitle,
    x_label: candidate.xLabel,
    y_label: candidate.yLabel,
    unit: candidate.unit,
    series: candidate.series,
    source_ref_ids: sourceRefIds,
    decision_reason: decision.reason,
  };
}
