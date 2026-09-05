"use client";

import { useEffect, useState } from "react";
import type {
  AuditEntry,
  DecisionTargetType,
  RejectReasonCode,
} from "@/lib/contracts/decision";

interface DecisionControlsProps {
  clientId: string;
  targetType: DecisionTargetType;
  targetId: string;
}

type Dialog = "accept" | "modify" | "reject" | null;

const rejectReasons: Array<{ value: RejectReasonCode; label: string }> = [
  { value: "not_applicable", label: "Not applicable" },
  { value: "client_already_aware", label: "Client already aware" },
  { value: "needs_compliance_review", label: "Needs compliance review" },
  { value: "insufficient_evidence", label: "Insufficient evidence" },
  { value: "client_preference", label: "Does not reflect client preference" },
  { value: "suitability_concern", label: "Suitability concern" },
  { value: "mandate_conflict", label: "Mandate conflict" },
  { value: "data_quality_concern", label: "Data quality concern" },
  { value: "timing_not_appropriate", label: "Timing not appropriate" },
  { value: "other", label: "Other" },
];

function decisionLabel(action: AuditEntry["action"]): string {
  if (action === "accept") return "Accepted";
  if (action === "modify") return "Modification requested";
  return "Rejected";
}

export function DecisionControls({
  clientId,
  targetType,
  targetId,
}: DecisionControlsProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [latest, setLatest] = useState<AuditEntry | null>(null);
  const [instructions, setInstructions] = useState("");
  const [reasonCode, setReasonCode] =
    useState<RejectReasonCode>("not_applicable");
  const [reasonText, setReasonText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      client_id: clientId,
      target_type: targetType,
      target_id: targetId,
    });
    fetch(`/api/decisions?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          decision?: AuditEntry | null;
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "Unable to load decision");
        setLatest(body.decision ?? null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Unable to load decision");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [clientId, targetId, targetType]);

  const submit = async () => {
    if (dialog === null) return;
    setSubmitting(true);
    setError(null);
    setAcknowledgement(null);
    const payload =
      dialog === "modify"
        ? {
            client_id: clientId,
            target_type: targetType,
            target_id: targetId,
            action: dialog,
            instructions,
          }
        : dialog === "reject"
          ? {
              client_id: clientId,
              target_type: targetType,
              target_id: targetId,
              action: dialog,
              reason_code: reasonCode,
              ...(reasonText.trim() ? { reason_text: reasonText } : {}),
            }
          : {
              client_id: clientId,
              target_type: targetType,
              target_id: targetId,
              action: dialog,
            };
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        decision?: AuditEntry;
        acknowledgement?: string;
        error?: string;
      };
      if (!response.ok || !body.decision) {
        throw new Error(body.error || "Unable to record decision");
      }
      setLatest(body.decision);
      setAcknowledgement(body.acknowledgement ?? "Decision recorded.");
      setDialog(null);
      setInstructions("");
      setReasonText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record decision");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-navy/10 bg-white/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-navy">
            RM decision
          </p>
          <p className="mt-1 text-xs text-slate/65">
            {loading
              ? "Loading latest decision…"
              : latest
                ? `${decisionLabel(latest.action)} by ${latest.rm_id} · ${new Date(latest.ts).toLocaleString()}`
                : "No decision recorded"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-navy px-3 py-2 text-xs font-semibold text-white"
            onClick={() => setDialog("accept")}
          >
            Accept
          </button>
          <button
            type="button"
            className="rounded-xl border border-bronze/50 bg-white px-3 py-2 text-xs font-semibold text-navy"
            onClick={() => setDialog("modify")}
          >
            Modify
          </button>
          <button
            type="button"
            className="rounded-xl border border-risk-high/30 bg-white px-3 py-2 text-xs font-semibold text-risk-high"
            onClick={() => setDialog("reject")}
          >
            Reject
          </button>
        </div>
      </div>

      {acknowledgement && (
        <p className="mt-3 text-xs font-medium text-grounded">{acknowledgement}</p>
      )}
      {error && <p className="mt-3 text-xs font-medium text-risk-high">{error}</p>}

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="decision-dialog-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#F7F5F0] p-6 shadow-2xl">
            <h3 id="decision-dialog-title" className="text-lg font-semibold text-navy">
              {dialog === "accept"
                ? "Accept recommendation"
                : dialog === "modify"
                  ? "Request modification"
                  : "Reject recommendation"}
            </h3>
            {dialog === "accept" && (
              <p className="mt-3 text-sm leading-6 text-slate">
                This records an acknowledgement for the RM workflow. It does not
                place, route, or execute any trade.
              </p>
            )}
            {dialog === "modify" && (
              <label className="mt-4 block text-sm font-medium text-navy">
                Required changes
                <textarea
                  className="mt-2 min-h-28 w-full rounded-xl border border-slate/20 bg-white p-3 text-sm text-slate"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="Describe what should change and why."
                />
              </label>
            )}
            {dialog === "reject" && (
              <div className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-navy">
                  Reason
                  <select
                    className="mt-2 w-full rounded-xl border border-slate/20 bg-white p-3 text-sm text-slate"
                    value={reasonCode}
                    onChange={(event) =>
                      setReasonCode(event.target.value as RejectReasonCode)
                    }
                  >
                    {rejectReasons.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-navy">
                  {reasonCode === "other" ? "Details (required)" : "Additional details"}
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-xl border border-slate/20 bg-white p-3 text-sm text-slate"
                    value={reasonText}
                    onChange={(event) => setReasonText(event.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate"
                onClick={() => setDialog(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={submit}
                disabled={
                  submitting ||
                  (dialog === "modify" && !instructions.trim()) ||
                  (dialog === "reject" &&
                    reasonCode === "other" &&
                    !reasonText.trim())
                }
              >
                {submitting ? "Recording…" : "Record decision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
