"use client";

import { useState } from "react";

export interface ListedHolding {
  portfolio_id: string;
  instrument_id: string;
  instrument_name: string;
  asset_class: string;
  market_value_usd: number;
}

interface TopHoldingsListProps {
  holdings: ListedHolding[];
  previewCount?: number;
}

function currency(value: number): string {
  return `$${(value / 1000).toFixed(0)}k`;
}

export function TopHoldingsList({
  holdings,
  previewCount = 10,
}: TopHoldingsListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? holdings : holdings.slice(0, previewCount);
  const remaining = Math.max(0, holdings.length - previewCount);

  return (
    <div>
      <div className="space-y-3">
        {visible.map((holding) => (
          <div
            key={`${holding.portfolio_id}-${holding.instrument_id}`}
            className="rounded-2xl bg-white/50 p-4 text-sm"
          >
            <p className="truncate font-semibold text-ink">{holding.instrument_name}</p>
            <div className="flex justify-between text-xs text-slate/68">
              <span>{holding.asset_class}</span>
              <span className="font-mono font-semibold text-lagoon">
                {currency(holding.market_value_usd)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-4 w-full rounded-2xl border border-white/70 bg-white/45 px-4 py-2.5 text-sm font-semibold text-navy transition hover:border-lagoon/35 hover:bg-white/70"
        >
          {expanded ? "See less" : `See more (${remaining} more)`}
        </button>
      )}
    </div>
  );
}
