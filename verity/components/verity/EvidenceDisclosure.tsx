import type { Grounding, SourceRef } from "@/lib/contracts/signal";

interface EvidenceDisclosureProps {
  sources: SourceRef[];
  grounding?: Grounding;
  label?: string;
}

function displayValue(value: SourceRef["values"][string]): string {
  if (value === null) return "null";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export function EvidenceDisclosure({
  sources,
  grounding,
  label = "Why this insight?",
}: EvidenceDisclosureProps) {
  if (sources.length === 0 && !grounding) return null;

  return (
    <details className="group rounded-2xl border border-grounded/25 bg-white/45 p-3">
      <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-[0.16em] text-grounded">
        {label}
      </summary>
      <div className="mt-3 space-y-3">
        {grounding && (
          <div className="rounded-xl border border-grounded/15 bg-grounded/5 p-3 text-xs leading-relaxed text-slate">
            <p>{grounding.explanation}</p>
            <p className="mt-1 font-medium text-slate/65">
              {grounding.no_match
                ? "No event-log entry was strong enough to claim causation."
                : `Matched event ${grounding.matched_event_ids.join(", ")}.`}{" "}
              Grounding confidence: {grounding.confidence}%.
            </p>
          </div>
        )}
        {sources.map((source, index) => (
          <div
            key={`${source.source}-${JSON.stringify(source.key)}-${index}`}
            className="rounded-xl border border-white/70 bg-white/65 p-3 text-xs text-slate"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-navy">{source.source}</span>
              <span className="font-mono text-[11px] text-slate/65">
                {Object.entries(source.key)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(" · ")}
              </span>
            </div>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              {source.fields.map((field) => (
                <div key={field} className="flex gap-2">
                  <dt className="font-medium text-slate/60">{field}</dt>
                  <dd className="break-words text-ink">
                    {displayValue(source.values[field] ?? null)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
