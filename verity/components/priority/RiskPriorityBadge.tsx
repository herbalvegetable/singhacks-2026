import type { StoredRiskPriority } from "@/lib/contracts/priority";
import { stripInternalReferenceTags } from "@/lib/agents/outputSanitizer";

interface RiskPriorityBadgeProps {
  priority?: StoredRiskPriority;
  inverse?: boolean;
}

export function RiskPriorityBadge({
  priority,
  inverse = false,
}: RiskPriorityBadgeProps) {
  if (!priority) {
    return (
      <span
        className={
          inverse
            ? "inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/65"
            : "inline-flex rounded-full bg-slate/8 px-3 py-1.5 text-xs font-semibold text-slate/55"
        }
      >
        Risk priority: scoring…
      </span>
    );
  }

  const tone =
    priority.risk_score >= 75
      ? "bg-risk-high text-white"
      : priority.risk_score >= 40
        ? "bg-risk-mid text-white"
        : "bg-grounded text-white";
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold shadow-sm ${tone}`}
      title={stripInternalReferenceTags(
        `${priority.risk_summary} ${priority.rationale}`,
      )}
      aria-label={`Risk priority score ${priority.risk_score} out of 100`}
    >
      Risk priority {priority.risk_score}/100
    </span>
  );
}
