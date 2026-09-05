import type { Grounding, SourceRef } from "@/lib/contracts/signal";

interface SourceLineageFooterProps {
  grounding?: Grounding;
  sources?: SourceRef[];
  window?: { from: string; to: string };
  compact?: boolean;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function sourceSummary(
  sources: SourceRef[],
  window?: { from: string; to: string },
): string {
  const grouped = new Map<string, { dates: Set<string>; ids: Set<string> }>();
  for (const source of sources) {
    const entry = grouped.get(source.source) ?? {
      dates: new Set<string>(),
      ids: new Set<string>(),
    };
    const date = source.key.snapshot_date ?? source.key.event_date;
    const id = source.key.event_id;
    if (date) entry.dates.add(date);
    if (id) entry.ids.add(id);
    grouped.set(source.source, entry);
  }

  return [...grouped.entries()]
    .map(([name, details]) => {
      const dates = [...details.dates];
      if (
        dates.length === 0 &&
        window &&
        ["holdings.csv", "instruments.csv", "transactions.csv"].includes(name)
      ) {
        dates.push(window.from, window.to);
      }
      const qualifiers = [
        dates.length > 0 ? dates.map(formatDate).join(", ") : "",
        details.ids.size > 0 ? [...details.ids].join(", ") : "",
      ].filter(Boolean);
      return `${name}${qualifiers.length > 0 ? ` (${qualifiers.join(" · ")})` : ""}`;
    })
    .join(" · ");
}

export function SourceLineageFooter({
  grounding,
  sources = [],
  window,
  compact = false,
}: SourceLineageFooterProps) {
  const allSources = [...sources, ...(grounding?.source_refs ?? [])].filter(
    (source, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.source === source.source &&
          JSON.stringify(candidate.key) === JSON.stringify(source.key),
      ) === index,
  );
  const summary = sourceSummary(allSources, window);

  return (
    <div className="text-xs leading-relaxed text-slate/70">
      <p>
        <span className="font-semibold text-navy">Sources:</span>{" "}
        {summary || "Lineage pending"}
      </p>
      {grounding && !compact && (
        <p className="mt-1.5">
          <span
            className={
              grounding.no_match
                ? "font-semibold text-risk-mid"
                : "font-semibold text-grounded"
            }
          >
            {grounding.no_match
              ? "No event match"
              : `Grounded in ${grounding.matched_event_ids.join(", ")}`}
          </span>
          {" · "}
          {grounding.confidence}% confidence
        </p>
      )}
    </div>
  );
}
