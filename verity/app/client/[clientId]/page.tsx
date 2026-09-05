import Link from "next/link";
import { getDb } from "@/lib/db/client";
import type { Signal } from "@/lib/contracts/signal";
import { SignalCard } from "@/components/verity/SignalCard";
import { CopilotWidget } from "@/components/copilot/CopilotWidget";
import {
  PortfolioAllocationPie,
  type PortfolioAllocationSlice,
} from "@/components/charts/PortfolioAllocationPie";
import { TopHoldingsPie } from "@/components/charts/TopHoldingsPie";
import { TopHoldingsList } from "@/components/verity/TopHoldingsList";
import { Repository, type Holding, type Portfolio } from "@/lib/db/repository";
import { PriorityAutoRefresh } from "@/components/priority/PriorityAutoRefresh";
import { RiskPriorityBadge } from "@/components/priority/RiskPriorityBadge";
import { stripInternalReferenceTags } from "@/lib/agents/outputSanitizer";
import { requirePageSession } from "@/lib/security/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clientId: string }>;
}

interface DossierClient {
  client_id: string;
  client_name: string;
  age: number | null;
  total_aum_usd: number;
  risk_profile: string;
  life_stage: string;
  objectives: string;
  tax_domicile: string;
  investment_horizon_years: number;
  client_since: string;
}

interface DossierPortfolio extends Portfolio {
  mandate_name: string;
}

interface QualityFlag {
  flag_id: string;
  severity: "error" | "warning";
  code: string;
  description: string;
}

interface PortfolioAllocationRow {
  portfolio_id: string;
  asset_class: string;
  value_usd: number;
}

export default async function ClientPage({ params }: PageProps) {
  const { clientId } = await params;
  const session = await requirePageSession();
  const db = getDb();
  const repository = new Repository();

  // Get client details
  const client = db
    .prepare("SELECT * FROM clients WHERE client_id = ? AND rm_id = ?")
    .get(clientId, session.rmId) as DossierClient | undefined;

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="glass-panel-strong rounded-3xl p-10 text-center">
          <h1 className="text-2xl font-bold text-navy">Client not found</h1>
          <Link href="/" className="mt-4 block text-lagoon hover:underline">
            Back to Morning Brief
          </Link>
        </div>
      </div>
    );
  }

  // Get signals
  const signalRows = db
    .prepare("SELECT payload FROM signals WHERE client_id = ?")
    .all(clientId) as { payload: string }[];

  const signals: Signal[] = signalRows
    .map((s) => JSON.parse(s.payload))
    .sort((a, b) => b.urgency_score - a.urgency_score);
  const groundingBySignal = new Map(
    repository
      .getGroundingsForClient(clientId)
      .map((grounding) => [grounding.signal_id, grounding]),
  );

  // Get portfolios
  const portfolios = db
    .prepare("SELECT * FROM portfolios WHERE client_id = ?")
    .all(clientId) as DossierPortfolio[];

  // Get holdings (latest snapshot)
  const holdings = db
    .prepare(
      `
      SELECT * FROM holdings 
      WHERE client_id = ?
        AND snapshot_date = (
          SELECT MAX(snapshot_date) FROM holdings WHERE client_id = ?
        )
      ORDER BY market_value_usd DESC
    `
    )
    .all(clientId, clientId) as Holding[];

  const allocationRows = db
    .prepare(
      `
      SELECT portfolio_id, asset_class, SUM(market_value_usd) AS value_usd
      FROM holdings
      WHERE client_id = ?
        AND snapshot_date = (
          SELECT MAX(snapshot_date) FROM holdings WHERE client_id = ?
        )
      GROUP BY portfolio_id, asset_class
      ORDER BY portfolio_id, value_usd DESC
    `,
    )
    .all(clientId, clientId) as PortfolioAllocationRow[];

  const allocationsByPortfolio = new Map<string, PortfolioAllocationSlice[]>();
  for (const row of allocationRows) {
    const slices = allocationsByPortfolio.get(row.portfolio_id) ?? [];
    slices.push({
      assetClass: row.asset_class,
      valueUsd: row.value_usd,
    });
    allocationsByPortfolio.set(row.portfolio_id, slices);
  }

  // Get data quality flags
  const flags = db
    .prepare("SELECT * FROM data_quality_flags WHERE scope_id LIKE ?")
    .all(`%${clientId}%`) as QualityFlag[];
  const priority = repository
    .getLatestRiskPrioritiesForRm(session.rmId)
    .find((assessment) => assessment.client_id === clientId);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <PriorityAutoRefresh />
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(6,26,61,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(6,26,61,0.045)_1px,transparent_1px)] bg-[size:56px_56px]" />
      {/* Header */}
      <header className="relative z-10 hero-glass text-ink-inv">
        <div className="mx-auto max-w-7xl px-4 pb-9 pt-20 sm:px-6 sm:py-11 lg:px-8">
          <Link href="/" className="mb-5 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm text-white/78 backdrop-blur hover:text-white">
            Back to Morning Brief
          </Link>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full bg-aqua/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-aqua">
                Client Dossier
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">{client.client_name}</h1>
              <p className="mt-2 max-w-3xl text-white/72">
                Source-backed signals, portfolio context, and RM-ready decision support.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
                <p className="text-xs text-white/60">AUM</p>
                <p className="font-semibold">${(client.total_aum_usd / 1_000_000).toFixed(2)}M</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
                <p className="text-xs text-white/60">Risk</p>
                <p className="font-semibold">{client.risk_profile}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
                <p className="text-xs text-white/60">Age</p>
                <p className="font-semibold">{client.age}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
                <p className="text-xs text-white/60">Risk Priority</p>
                <p className="font-semibold">
                  {priority ? `${priority.risk_score}/100` : "Scoring…"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <section className="glass-panel-strong mb-7 rounded-3xl p-5 surface-ring sm:mb-8 sm:p-7">
          <h3 className="mb-4 text-center font-semibold text-navy">Client Profile</h3>
          <dl className="flex flex-wrap items-stretch justify-center gap-3">
            <div className="min-w-[10.5rem] flex-1 rounded-2xl bg-white/42 px-4 py-3 text-center sm:max-w-[14rem]">
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate/58">Life Stage</dt>
              <dd className="mt-1 font-semibold text-ink">{client.life_stage}</dd>
            </div>
            <div className="min-w-[16rem] flex-[1.6] rounded-2xl bg-white/42 px-4 py-3 text-center sm:max-w-[22rem]">
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate/58">Objectives</dt>
              <dd className="mt-1 font-semibold text-ink">{client.objectives}</dd>
            </div>
            <div className="min-w-[10.5rem] flex-1 rounded-2xl bg-white/42 px-4 py-3 text-center sm:max-w-[14rem]">
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate/58">Tax Domicile</dt>
              <dd className="mt-1 font-semibold text-ink">{client.tax_domicile}</dd>
            </div>
            <div className="min-w-[10.5rem] flex-1 rounded-2xl bg-white/42 px-4 py-3 text-center sm:max-w-[14rem]">
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate/58">Investment Horizon</dt>
              <dd className="mt-1 font-semibold text-ink">
                {client.investment_horizon_years} years
              </dd>
            </div>
            <div className="min-w-[10.5rem] flex-1 rounded-2xl bg-white/42 px-4 py-3 text-center sm:max-w-[14rem]">
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate/58">Client Since</dt>
              <dd className="mt-1 font-semibold text-ink">{client.client_since}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-col items-center justify-center gap-2.5 border-t border-white/55 pt-4 text-center">
            <div className="flex w-full items-center justify-center">
              <RiskPriorityBadge priority={priority} />
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-slate/70">
              {priority
                ? stripInternalReferenceTags(
                    `${priority.risk_summary} ${priority.rationale}`,
                  )
                : "Generating a book-calibrated risk summary and priority score with GPT-4o."}
            </p>
          </div>
        </section>

        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-7">
          <section className="glass-panel rounded-3xl p-5 sm:p-7">
            <h3 className="mb-5 font-semibold text-navy">
              Portfolios ({portfolios.length})
            </h3>
            <div className="space-y-3.5">
              {portfolios.map((p) => (
                <div key={p.portfolio_id} className="rounded-2xl bg-white/54 p-4 text-sm">
                  <p className="font-semibold text-ink">{p.portfolio_name}</p>
                  <p className="text-xs text-slate/55">{p.portfolio_id}</p>
                  <p className="mt-1 text-xs text-slate/70">
                    Mandate: {p.mandate_name}
                  </p>
                  <PortfolioAllocationPie
                    data={allocationsByPortfolio.get(p.portfolio_id) ?? []}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-3xl p-5 sm:p-7">
            <h3 className="mb-5 font-semibold text-navy">Top Holdings</h3>
            <TopHoldingsPie
              holdings={holdings.map((holding) => ({
                instrumentId: holding.instrument_id,
                instrumentName: holding.instrument_name,
                valueUsd: holding.market_value_usd,
              }))}
            />
            <TopHoldingsList
              holdings={holdings.map((holding) => ({
                portfolio_id: holding.portfolio_id,
                instrument_id: holding.instrument_id,
                instrument_name: holding.instrument_name,
                asset_class: holding.asset_class,
                market_value_usd: holding.market_value_usd,
              }))}
            />
          </section>
        </div>

        <div className="space-y-8 lg:space-y-10">
          {flags.length > 0 && (
            <section className="glass-panel rounded-3xl border-l-4 border-risk-mid p-5 sm:p-7">
              <h3 className="mb-2 font-semibold text-navy">
                Data Quality Flags ({flags.length})
              </h3>
              <div className="space-y-2">
                {flags.map((flag) => (
                  <div key={flag.flag_id} className="rounded-2xl bg-white/52 p-4 text-sm">
                    <span
                      className={`mr-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${
                        flag.severity === "error"
                          ? "bg-risk-high text-white"
                          : "bg-risk-mid text-white"
                      }`}
                    >
                      {flag.code}
                    </span>
                    <span className="text-slate">{flag.description}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-navy">
              Signals ({signals.length})
            </h2>

            {signals.length === 0 && (
              <p className="glass-panel rounded-2xl p-5 text-slate/70">No signals for this client.</p>
            )}

            <div className="space-y-5 sm:space-y-6">
              {signals.map((signal) => (
                <SignalCard
                  key={signal.signal_id}
                  signal={signal}
                  grounding={groundingBySignal.get(signal.signal_id)}
                />
              ))}
            </div>
          </section>
        </div>
      </main>
      <CopilotWidget
        clientId={client.client_id}
        clientName={client.client_name}
      />
    </div>
  );
}
