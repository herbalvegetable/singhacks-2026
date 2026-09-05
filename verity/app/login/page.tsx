import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(6,26,61,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(6,26,61,0.045)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <div className="pointer-events-none absolute left-1/2 top-16 h-72 w-72 -translate-x-1/2 rounded-full bg-aqua/28 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 right-10 h-80 w-80 rounded-full bg-violet/20 blur-3xl" />

      <section className="glass-panel-strong surface-ring relative z-10 w-full max-w-md rounded-[2rem] p-7 sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[linear-gradient(135deg,#27ddeb,#8b5cf6)] text-2xl font-bold text-white shadow-[0_18px_42px_rgba(39,221,235,.28)]">
          V
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-lagoon">
            Verity Access
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-navy">
            Welcome back
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate/70">
            Sign in to open the relationship manager workbench.
          </p>
        </div>

        <LoginForm />
      </section>
    </main>
  );
}
