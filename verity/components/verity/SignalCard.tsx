"use client";

import { useState } from "react";
import type { Grounding, Signal } from "@/lib/contracts/signal";
import { DiversificationPanel } from "./DiversificationPanel";
import { DecisionControls } from "./DecisionControls";
import { EvidenceDisclosure } from "./EvidenceDisclosure";
import { SourceLineageFooter } from "./SourceLineageFooter";

interface SignalCardProps {
  signal: Signal;
  grounding?: Grounding;
}

interface Narrative {
  story: string;
  opening_line: string;
  recommended_action: {
    title: string;
    rationale: string;
    steps: string[];
    confidence: number;
  } | null;
  caveats: string[];
  confidence: number;
  suitability?: {
    status:
      | "discussion_only"
      | "no_portfolio_change"
      | "requires_quantified_analysis";
    statement: string;
  };
}

export function SignalCard({ signal, grounding }: SignalCardProps) {
  const hideListedSources =
    signal.type === "explanation" || signal.type === "risk";
  const [showNarrative, setShowNarrative] = useState(false);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNarrative = async () => {
    if (narrative) {
      setShowNarrative(!showNarrative);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/narrative/${signal.signal_id}`, {
        method: "POST",
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const serverError =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : null;
        throw new Error(serverError || `Failed to load narrative (${response.status})`);
      }
      const data = (await response.json()) as Narrative;
      setNarrative(data);
      setShowNarrative(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load narrative");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel-strong rounded-3xl p-5 surface-ring sm:p-7 lg:p-8">
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] shadow-sm ${
              signal.type === "risk"
                ? "bg-risk-high text-white"
                : signal.type === "opportunity"
                ? "bg-opportunity text-navy"
                : signal.type === "explanation"
                ? "bg-grounded text-white"
                : "bg-lagoon text-white"
            }`}
          >
            {signal.type}
          </span>
          {signal.subtype && (
            <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-medium text-slate/62">
              {signal.subtype}
            </span>
          )}
        </div>
        <h3 className="text-lg font-semibold text-navy">
          {signal.headline}
        </h3>
      </div>

      {/* Magnitude */}
      {(signal.magnitude_usd || signal.magnitude_pct) && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-2xl bg-white/56 px-3 py-2 text-sm text-slate shadow-sm">
          {signal.magnitude_usd && (
            <span className="font-mono font-semibold text-navy">
              ${Math.abs(signal.magnitude_usd).toLocaleString()}
            </span>
          )}
          {signal.magnitude_pct && (
            <span className="font-mono font-semibold text-lagoon">
              ({signal.magnitude_pct.toFixed(1)}%)
            </span>
          )}
        </div>
      )}

      {/* Affected Holdings */}
      {signal.affected_holdings.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate/58 uppercase tracking-[0.18em] mb-2">
            Affected Holdings
          </p>
          <div className="space-y-2">
            {signal.affected_holdings.slice(0, 3).map((h, idx) => (
              <div key={idx} className="flex justify-between rounded-2xl bg-white/50 px-3 py-2 text-sm">
                <span className="font-medium text-ink">{h.instrument_name}</span>
                <span className="font-mono font-semibold text-lagoon">
                  ${h.market_value_usd.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(grounding || !hideListedSources) && (
        <div className="mt-4 space-y-2">
          <EvidenceDisclosure
            sources={
              hideListedSources
                ? []
                : [...signal.evidence, ...(grounding?.source_refs ?? [])]
            }
            grounding={grounding}
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-3 border-t border-white/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
        {!hideListedSources && (
          <SourceLineageFooter
            grounding={grounding}
            sources={signal.evidence}
            window={signal.window}
          />
        )}

        <button
          onClick={loadNarrative}
          disabled={loading}
          className={`vibrant-button disabled:opacity-50${hideListedSources ? " sm:ml-auto" : ""}`}
        >
          {loading
            ? "Generating analysis..."
            : showNarrative
            ? "Hide Analysis"
            : "Generate Analysis →"}
        </button>
      </div>

      {loading && (
        <div
          className="analysis-skeleton mt-4 rounded-3xl border border-slate/10 bg-white/40 p-5 shadow-inner backdrop-blur-xl"
          aria-hidden="true"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="skeleton-bar h-3 w-24 rounded-full" />
            <div className="skeleton-bar h-5 w-20 rounded-full" />
          </div>
          <div className="space-y-2.5">
            <div className="skeleton-bar h-3 w-full rounded-full" />
            <div className="skeleton-bar h-3 w-[94%] rounded-full" />
            <div className="skeleton-bar h-3 w-[88%] rounded-full" />
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="skeleton-bar h-3 w-[96%] rounded-full" />
            <div className="skeleton-bar h-3 w-[82%] rounded-full" />
            <div className="skeleton-bar h-3 w-[70%] rounded-full" />
          </div>
          <div className="mt-5 rounded-2xl border border-white/50 bg-white/35 p-4">
            <div className="skeleton-bar mb-3 h-2.5 w-28 rounded-full" />
            <div className="skeleton-bar h-3 w-[78%] rounded-full" />
          </div>
          <div className="mt-4 rounded-2xl border border-white/50 bg-white/35 p-4">
            <div className="skeleton-bar mb-3 h-2.5 w-36 rounded-full" />
            <div className="skeleton-bar mb-2 h-3 w-[90%] rounded-full" />
            <div className="skeleton-bar h-3 w-[64%] rounded-full" />
          </div>
        </div>
      )}

      {/* Narrative */}
      {error && (
        <div className="mt-4 rounded-2xl border border-risk-high/30 bg-risk-high/10 p-3 text-sm font-medium text-risk-high">
          {error}
        </div>
      )}

      {showNarrative && narrative && (
        <div className="mt-4 rounded-3xl border border-grounded/25 bg-white/48 p-5 shadow-inner backdrop-blur-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold text-grounded uppercase tracking-[0.18em]">
              AI Analysis
            </span>
            <span
              className={`confidence-badge ${
                narrative.confidence >= 70
                  ? "confidence-high"
                  : narrative.confidence >= 40
                  ? "confidence-med"
                  : "confidence-low"
              }`}
            >
              {narrative.confidence}% confident
            </span>
          </div>

          <div className="space-y-3 text-sm">
            {narrative.story.split('\n\n').map((para: string, idx: number) => (
              <p key={idx} className="text-slate">
                {para}
              </p>
            ))}
          </div>

          {narrative.opening_line && (
            <div className="mt-4 rounded-2xl border border-bronze/35 bg-white/64 p-4">
              <p className="text-xs font-bold text-slate/58 uppercase tracking-[0.18em] mb-1">
                Opening Line
              </p>
              <p className="text-sm italic text-navy">
                &ldquo;{narrative.opening_line}&rdquo;
              </p>
            </div>
          )}

          {narrative.recommended_action && (
            <div className="mt-4">
              <p className="text-xs font-bold text-slate/58 uppercase tracking-[0.18em] mb-2">
                Recommended Action
              </p>
              <div className="rounded-2xl border border-white/65 bg-white/66 p-4 shadow-sm">
                <p className="font-semibold text-sm text-navy mb-2">
                  {narrative.recommended_action.title}
                </p>
                <p className="text-sm text-slate mb-2">
                  {narrative.recommended_action.rationale}
                </p>
                {narrative.recommended_action.steps.length > 0 && (
                  <ol className="list-decimal list-inside text-sm text-slate space-y-1">
                    {narrative.recommended_action.steps.map(
                      (step: string, idx: number) => (
                        <li key={idx}>{step}</li>
                      )
                    )}
                  </ol>
                )}
                <DecisionControls
                  clientId={signal.client_id}
                  targetType="narrative_recommendation"
                  targetId={signal.signal_id}
                />
              </div>
            </div>
          )}

          {narrative.suitability && (
            <div className="mt-3 rounded-2xl border border-lagoon/20 bg-white/55 p-3">
              <span className="compliance-chip">
                {narrative.suitability.status === "requires_quantified_analysis"
                  ? "Quantified analysis required"
                  : narrative.suitability.status === "no_portfolio_change"
                    ? "No portfolio change"
                    : "Discussion only"}
              </span>
              <p className="mt-2 text-xs leading-5 text-slate/72">
                {narrative.suitability.statement}
              </p>
            </div>
          )}

          {narrative.caveats && narrative.caveats.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold text-slate/58 uppercase tracking-[0.18em] mb-2">
                Caveats & Uncertainties
              </p>
              <ul className="list-disc list-inside text-sm text-slate/72 space-y-1">
                {narrative.caveats.map((caveat: string, idx: number) => (
                  <li key={idx}>{caveat}</li>
                ))}
              </ul>
            </div>
          )}

          <DiversificationPanel
            signalId={signal.signal_id}
            clientId={signal.client_id}
          />
        </div>
      )}
    </div>
  );
}
