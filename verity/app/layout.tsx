import type { Metadata } from "next";
import { AppShell } from "@/components/navigation/AppShell";
import { Repository } from "@/lib/db/repository";
import { getCurrentSession } from "@/lib/security/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verity — Wealth Intelligence Workbench",
  description: "AI-powered relationship intelligence for private banking",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();
  const clients = (session
    ? new Repository().getClientsForRm(session.rmId)
    : [])
    .map(({ client_id, client_name }) => ({ client_id, client_name }));

  return (
    <html lang="en">
      <body className="antialiased bg-bg text-ink">
        <AppShell
          clients={clients}
          authenticated={Boolean(session)}
          displayName={session?.displayName ?? ""}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
