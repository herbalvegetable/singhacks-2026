import { createHash } from "crypto";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  GROUNDING_NO_MATCH_MESSAGE,
  type Grounding,
  type Signal,
  type SourceRef,
} from "../contracts/signal";
import type { Instrument, MarketEvent } from "../db/repository";
import { stripInternalReferenceTags } from "./outputSanitizer";
import {
  OPENAI_REQUEST_OPTIONS,
  requireAgentsEnabled,
} from "./runtime";

export const GROUNDING_PROMPT_VERSION = "event-grounding-v1";
const MAX_EVENT_DISTANCE_DAYS = 180;
const MAX_CANDIDATES = 8;

export interface EventCandidate extends MarketEvent {
  distance_days: number;
  match_score: number;
  topic_matches: number;
}

const GroundingDecision = z.object({
  has_clear_match: z.boolean(),
  matched_event_ids: z.array(z.string()).max(3),
  explanation: z.string(),
  confidence: z.number().int().min(0).max(100),
});

function words(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !["and", "the", "for", "with", "from", "global", "client"].includes(word),
    );
}

function signalTerms(signal: Signal, instruments: Instrument[]): Set<string> {
  const values = [
    signal.subtype,
    signal.headline,
    ...signal.affected_holdings.flatMap((holding) => [
      holding.instrument_id,
      holding.instrument_name,
    ]),
    ...instruments.flatMap((instrument) => [
      instrument.instrument_name,
      instrument.asset_class,
      instrument.sub_asset_class,
      instrument.sector,
      instrument.region,
      instrument.underlying_reference ?? "",
    ]),
  ];
  const terms = new Set(values.flatMap(words));
  const joined = values.join(" ").toLowerCase();

  if (joined.includes("fixed income") || joined.includes("bond")) {
    ["bond", "credit", "duration", "fixed", "income", "rate", "rates"].forEach((term) =>
      terms.add(term),
    );
  }
  if (joined.includes("equity") || joined.includes("stock")) {
    ["equity", "equities", "stock"].forEach((term) => terms.add(term));
  }
  if (joined.includes("technology") || joined.includes("tech")) {
    ["technology", "tech", "growth", "ai"].forEach((term) => terms.add(term));
  }
  if (joined.includes("energy") || joined.includes("oil")) {
    ["energy", "oil", "brent", "lng"].forEach((term) => terms.add(term));
  }
  if (joined.includes("gold") || joined.includes("precious")) {
    ["gold", "precious", "metals"].forEach((term) => terms.add(term));
  }
  return terms;
}

function dateDistanceDays(left: string, right: string): number {
  const leftMs = Date.parse(`${left.slice(0, 10)}T00:00:00Z`);
  const rightMs = Date.parse(`${right.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(leftMs - rightMs) / 86_400_000;
}

export function filterEventCandidates(
  signal: Signal,
  events: MarketEvent[],
  instruments: Instrument[],
): EventCandidate[] {
  const referenceDate =
    signal.window.to || signal.evidence[0]?.key.snapshot_date || signal.computed_at.slice(0, 10);
  const terms = signalTerms(signal, instruments);

  return events
    .map((event) => {
      const distanceDays = dateDistanceDays(referenceDate, event.event_date);
      const eventTerms = new Set(
        words(
          [
            event.primary_transmission,
            event.transmission_tokens,
            event.description,
            event.region,
          ].join(" "),
        ),
      );
      const overlap = [...terms].filter((term) => eventTerms.has(term)).length;
      return {
        ...event,
        distance_days: Math.round(distanceDays),
        match_score: overlap * 100 + Math.max(0, MAX_EVENT_DISTANCE_DAYS - distanceDays),
        topic_matches: overlap,
      };
    })
    .filter(
      (event) =>
        event.distance_days <= MAX_EVENT_DISTANCE_DAYS && event.topic_matches > 0,
    )
    .sort(
      (left, right) =>
        right.match_score - left.match_score ||
        left.distance_days - right.distance_days ||
        left.event_id.localeCompare(right.event_id),
    )
    .slice(0, MAX_CANDIDATES);
}

export function hashGroundingInput(
  signal: Signal,
  candidates: EventCandidate[],
): string {
  const stableSignal = { ...signal, computed_at: undefined };
  return createHash("sha256")
    .update(
      JSON.stringify({
        prompt_version: GROUNDING_PROMPT_VERSION,
        signal: stableSignal,
        candidates,
      }),
    )
    .digest("hex");
}

function eventSourceRef(event: MarketEvent): SourceRef {
  return {
    source: "event_log.csv",
    key: { event_id: event.event_id },
    fields: [
      "event_date",
      "event_type",
      "region",
      "description",
      "primary_transmission",
      "severity",
    ],
    values: {
      event_date: event.event_date,
      event_type: event.event_type,
      region: event.region,
      description: event.description,
      primary_transmission: event.primary_transmission,
      severity: event.severity,
    },
  };
}

export function buildNoMatchGrounding(
  signal: Signal,
  candidates: EventCandidate[],
): Grounding {
  return {
    signal_id: signal.signal_id,
    explanation: GROUNDING_NO_MATCH_MESSAGE,
    matched_event_ids: [],
    candidate_event_ids: candidates.map((candidate) => candidate.event_id),
    confidence: 20,
    no_match: true,
    source_refs: [],
    model: "gpt-4o",
    prompt_version: GROUNDING_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
  };
}

export class GroundingAgent {
  private readonly openai: OpenAI;

  constructor(
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY ?? "agents-disabled",
      ...OPENAI_REQUEST_OPTIONS,
    }),
  ) {
    this.openai = openai;
  }

  async ground(signal: Signal, candidates: EventCandidate[]): Promise<Grounding> {
    if (candidates.length === 0) return buildNoMatchGrounding(signal, candidates);
    requireAgentsEnabled();

    const allowedIds = new Set(candidates.map((candidate) => candidate.event_id));
    const completion = await this.openai.chat.completions.parse({
      model: "gpt-4o",
      temperature: 0,
      response_format: zodResponseFormat(GroundingDecision, "event_grounding"),
      messages: [
        {
          role: "system",
          content: `You are Verity's event-grounding agent. Your only job is to assess whether one or more supplied event candidates plausibly explains the supplied deterministic portfolio signal.

Rules:
- Use only the supplied signal and candidate events.
- matched_event_ids may contain only IDs from ALLOWED_EVENT_IDS.
- Never use outside market knowledge, invent an event, perform arithmetic, recommend an action, or assess client suitability.
- If there is no clear causal link, set has_clear_match=false, matched_event_ids=[], confidence below 30, and explanation exactly "${GROUNDING_NO_MATCH_MESSAGE}"
- A match requires a plausible transmission mechanism, not merely similar dates.
- Keep a matched explanation to one concise paragraph and state uncertainty plainly.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            ALLOWED_EVENT_IDS: candidates.map((candidate) => candidate.event_id),
            signal,
            candidate_events: candidates,
          }),
        },
      ],
      max_completion_tokens: 500,
    });

    const decision = completion.choices[0].message.parsed;
    if (!decision || !decision.has_clear_match || decision.matched_event_ids.length === 0) {
      return buildNoMatchGrounding(signal, candidates);
    }

    const citedIdsInText = decision.explanation.match(/\bEVT-\d+\b/g) ?? [];
    if (
      decision.matched_event_ids.some((eventId) => !allowedIds.has(eventId)) ||
      citedIdsInText.some((eventId) => !allowedIds.has(eventId))
    ) {
      return buildNoMatchGrounding(signal, candidates);
    }

    const matchedEvents = decision.matched_event_ids.map(
      (eventId) => candidates.find((candidate) => candidate.event_id === eventId)!,
    );
    return {
      signal_id: signal.signal_id,
      explanation: stripInternalReferenceTags(decision.explanation),
      matched_event_ids: decision.matched_event_ids,
      candidate_event_ids: candidates.map((candidate) => candidate.event_id),
      confidence: Math.min(85, decision.confidence),
      no_match: false,
      source_refs: matchedEvents.map(eventSourceRef),
      model: "gpt-4o",
      prompt_version: GROUNDING_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
    };
  }
}
