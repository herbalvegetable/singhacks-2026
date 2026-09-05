import { LogoutButton } from "@/components/auth/LogoutButton";
import { requirePageSession } from "@/lib/security/auth";

const PROFILE_FIELDS = [
  { label: "Role", value: "Relationship Manager" },
  { label: "Desk", value: "Asia desk" },
  { label: "Booking centres", value: "Singapore / Hong Kong" },
  { label: "Coverage", value: "20 UHNW clients" },
  { label: "Book range", value: "$8M – $88M AUM" },
  { label: "Location", value: "Singapore" },
  { label: "Tenure", value: "9 years" },
];

export default async function ProfilePage() {
  const session = await requirePageSession();
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(6,26,61,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(6,26,61,0.045)_1px,transparent_1px)] bg-[size:56px_56px]" />

      <header className="relative z-10 hero-glass text-ink-inv">
        <div className="mx-auto max-w-7xl px-4 pb-9 pt-20 sm:px-6 sm:py-11 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f6c453,#ff9f43)] text-xl font-bold text-navy shadow-lg">
                PO
              </span>
              <div>
                <div className="inline-flex items-center rounded-full bg-aqua/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-aqua">
                  Relationship Manager
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                  {session.displayName}
                </h1>
                <p className="mt-2 max-w-3xl text-white/72">
                  Asia desk coverage across Singapore and Hong Kong booking
                  centres, with a 20-client book and back-to-back meetings.
                </p>
              </div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <section className="glass-panel-strong mb-7 rounded-3xl p-5 surface-ring sm:mb-8 sm:p-7">
          <h3 className="mb-4 text-center font-semibold text-navy">
            RM Profile
          </h3>
          <dl className="flex flex-wrap items-stretch justify-center gap-3">
            {[...PROFILE_FIELDS, { label: "Employee ID", value: session.rmId }].map((field) => (
              <div
                key={field.label}
                className="min-w-[10.5rem] flex-1 rounded-2xl bg-white/42 px-4 py-3 text-center sm:max-w-[14rem]"
              >
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate/58">
                  {field.label}
                </dt>
                <dd className="mt-1 font-semibold text-ink">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="glass-panel-strong rounded-3xl p-5 surface-ring sm:p-7">
          <h3 className="mb-3 font-semibold text-navy">Working brief</h3>
          <p className="max-w-3xl text-sm leading-relaxed text-slate/70">
            Priscilla uses Verity to prepare for client conversations without
            reconciling five portfolio snapshots against a year of market events
            by hand. Her priority is knowing who to call first, why it matters
            for that client’s life, and what she can stand behind in the room.
          </p>
        </section>
      </main>
    </div>
  );
}
