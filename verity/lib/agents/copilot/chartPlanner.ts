import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  CopilotChartType,
  type ContextPack,
  type CopilotAnswer,
  type CopilotChart,
} from "../../contracts/chat";
import {
  buildVisualizationCandidates,
  materializeVisualization,
  shouldConsiderVisualization,
  type VisualizationDecision,
} from "./visualization";
import {
  agentsEnabled,
  OPENAI_REQUEST_OPTIONS,
} from "../runtime";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "agents-disabled",
  ...OPENAI_REQUEST_OPTIONS,
});

const ChartDecision = z.object({
  should_display: z.boolean(),
  candidate_id: z.string().max(120).nullable(),
  chart_type: CopilotChartType.nullable(),
  title: z.string().max(180).nullable(),
  reason: z.string().max(500),
});

export interface ChartPlanningResult {
  considered: boolean;
  reason: string;
  chart: CopilotChart | null;
}

export async function planCopilotVisualization(
  pack: ContextPack,
  answer: CopilotAnswer,
): Promise<ChartPlanningResult> {
  if (!agentsEnabled()) {
    return {
      considered: false,
      reason: "AI visualization planning is disabled.",
      chart: null,
    };
  }
  const candidates = buildVisualizationCandidates(pack);
  if (!shouldConsiderVisualization(pack.query, answer, candidates)) {
    return {
      considered: false,
      reason: "The answer does not contain a comparison or statistical pattern that benefits from a chart.",
      chart: null,
    };
  }

  const completion = await openai.chat.completions.parse({
    model: "gpt-4o",
    temperature: 0.05,
    response_format: zodResponseFormat(ChartDecision, "chart_decision"),
    max_completion_tokens: 350,
    messages: [
      {
        role: "system",
        content: `You are Verity's visualization planner. Decide whether a chart materially improves a grounded RM Copilot answer.

Follow this decision sequence:
1. Identify the quantitative relationship the user needs to understand.
2. Check that a supplied deterministic candidate directly represents it.
3. Prefer no chart for a single number, simple fact, unsupported question, or decorative use.
4. Select the clearest supported chart type:
   - pie: composition of a whole with few categories
   - bar: categorical comparison or ranking
   - line: values ordered over time
   - histogram: distribution across numeric ranges
5. Return only a candidate_id and supported chart_type. Never create, modify, aggregate, or infer data.

The reason must be a concise decision rationale, not hidden chain-of-thought. If no candidate fits, set should_display false and candidate_id/chart_type/title to null.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            query: pack.query,
            answer: answer.answer,
            candidates: candidates.map((candidate) => ({
              candidate_id: candidate.candidateId,
              title: candidate.title,
              supported_types: candidate.supportedTypes,
              series_count: candidate.series.length,
              point_count: candidate.series.reduce(
                (sum, series) => sum + series.points.length,
                0,
              ),
              labels: candidate.series
                .flatMap((series) => series.points.map((point) => point.label))
                .slice(0, 12),
            })),
          },
          null,
          2,
        ),
      },
    ],
  });
  const parsed = completion.choices[0].message.parsed;
  if (!parsed) {
    return {
      considered: true,
      reason: "The visualization planner returned no valid decision.",
      chart: null,
    };
  }
  const decision: VisualizationDecision = {
    shouldDisplay: parsed.should_display,
    candidateId: parsed.candidate_id,
    chartType: parsed.chart_type,
    title: parsed.title,
    reason: parsed.reason,
  };
  return {
    considered: true,
    reason: decision.reason,
    chart: materializeVisualization(pack, candidates, decision),
  };
}
