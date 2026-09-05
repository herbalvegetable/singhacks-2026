import Link from "next/link";
import type { Grounding, Signal } from "@/lib/contracts/signal";
import type { StoredRiskPriority } from "@/lib/contracts/priority";
import { Repository } from "@/lib/db/repository";
import { PriorityAutoRefresh } from "@/components/priority/PriorityAutoRefresh";
import { RiskPriorityBadge } from "@/components/priority/RiskPriorityBadge";
import { SourceLineageFooter } from "@/components/verity/SourceLineageFooter";
import { requirePageSession } from "@/lib/security/auth";

interface ClientWithSignals {
  client_id: string;
  client_name: string;
  total_aum_usd: number;
  signal_count: number;
  urgency_max: number;
  signals: Signal[];
  groundingBySignal: Map<string, Grounding>;
  priority?: StoredRiskPriority;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requirePageSession();
  const repository = new Repository();
  const [priorities, briefClients] = await Promise.all([
    repository.getLatestRiskPrioritiesForRm(session.rmId),
    repository.getMorningBriefClients(session.rmId),
  ]);
  const priorityByClient = new Map(
    priorities.map((priority) => [priority.client_id, priority]),
  );

  const clientsWithSignals: ClientWithSignals[] = await Promise.all(
    briefClients.map(async (client) => {
    const groundingBySignal = new Map(
      (await repository.getGroundingsForClient(client.client_id))
        .map((grounding) => [grounding.signal_id, grounding]),
    );
    const urgencyMax = client.signals.length > 0
      ? Math.max(...client.signals.map((signal) => signal.urgency_score))
      : 0;

    return {
      client_id: client.client_id,
      client_name: client.client_name,
      total_aum_usd: client.total_aum_usd,
      signal_count: client.signals.length,
      urgency_max: urgencyMax,
      signals: client.signals,
      groundingBySignal,
      priority: priorityByClient.get(client.client_id),
    };
  }));

  // Use the calibrated book-wide score when available, then deterministic urgency.
  clientsWithSignals.sort(
    (a, b) =>
      (b.priority?.risk_score ?? -1) - (a.priority?.risk_score ?? -1) ||
      b.urgency_max - a.urgency_max,
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <PriorityAutoRefresh />
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(6,26,61,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(6,26,61,0.045)_1px,transparent_1px)] bg-[size:56px_56px]" />
      {/* Header */}
      <header className="relative z-10 hero-glass text-ink-inv">
        <div className="mx-auto max-w-7xl px-4 pb-9 pt-20 sm:px-6 sm:py-11 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-aqua backdrop-blur">
                Grounded Wealth Intelligence
              </div>
              <h1 className="mt-4 text-5xl font-semibold tracking-tight">Verity</h1>
              <p className="mt-2 max-w-2xl text-base text-white/78">
                A vibrant command center for signals, source-backed reasoning, and RM-ready next steps.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur-md">
                <p className="text-2xl font-semibold">{clientsWithSignals.length}</p>
                <p className="text-xs text-white/65">Clients</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur-md">
                <p className="text-2xl font-semibold">
                  {clientsWithSignals.reduce((sum, client) => sum + client.signal_count, 0)}
                </p>
                <p className="text-xs text-white/65">Signals</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur-md">
                <p className="text-2xl font-semibold">
                  {priorities.length > 0
                    ? Math.max(
                        ...priorities.map((priority) => priority.risk_score),
                      )
                    : "—"}
                </p>
                <p className="text-xs text-white/65">Top Risk Priority</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <div className="mb-6 glass-panel rounded-3xl p-5 surface-ring sm:mb-8 sm:p-7">
          <h2 className="text-2xl font-semibold mb-2 text-navy">Morning Brief</h2>
          <p className="text-sm text-slate/75">
            {clientsWithSignals.length} clients with signals requiring attention
          </p>
        </div>

        <div className="space-y-5 sm:space-y-6">
          {clientsWithSignals.map((client) => (
            <Link
              key={client.client_id}
              href={`/client/${client.client_id}`}
              className="group block glass-panel rounded-3xl p-5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_32px_90px_rgba(14,165,233,0.20)] surface-ring sm:p-7 lg:p-8"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xl font-semibold text-navy">{client.client_name}</h3>
                    <RiskPriorityBadge priority={client.priority} />
                  </div>

                  <div className="mt-2.5 text-sm font-medium text-slate/75">
                    AUM: ${(client.total_aum_usd / 1_000_000).toFixed(1)}M
                  </div>

                  <div className="mt-5 space-y-3">
                    {client.signals.slice(0, 2).map((signal) => (
                      <div
                        key={signal.signal_id}
                        className={`signal-card ${signal.type}`}
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs uppercase font-bold tracking-[0.16em] text-slate/60">
                              {signal.type}
                            </span>
                            {signal.subtype && (
                              <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs text-slate/55">
                                {signal.subtype}
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-snug text-ink">
                            {signal.headline}
                          </p>
                          <div className="mt-2">
                            <SourceLineageFooter
                              grounding={client.groundingBySignal.get(signal.signal_id)}
                              sources={signal.evidence}
                              window={signal.window}
                              compact
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {client.signal_count > 2 && (
                      <p className="pl-1 text-sm font-medium text-slate/60">
                        +{client.signal_count - 2} more signal
                        {client.signal_count - 2 !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>

                <div className="ml-6 text-right">
                  <svg
                    className="w-6 h-6 text-lagoon transition group-hover:translate-x-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {clientsWithSignals.length === 0 && (
          <div className="glass-panel rounded-3xl py-12 text-center text-slate/70">
            <p>No signals found. Run the pipeline first:</p>
            <code className="mt-2 inline-block rounded-full bg-white/70 px-3 py-1 text-sm text-navy">
              npm run pipeline
            </code>
          </div>
        )}
      </main>
    </div>
  );
}
