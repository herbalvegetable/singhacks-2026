"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface SidebarClient {
  client_id: string;
  client_name: string;
}

interface AppSidebarProps {
  clients: SidebarClient[];
  displayName: string;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M3 10.8 12 3l9 7.8V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ClientsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppSidebar({ clients, displayName }: AppSidebarProps) {
  const pathname = usePathname();
  const onClientPage = pathname.startsWith("/client/");
  const [clientsOpen, setClientsOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-4 py-5">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="group flex items-center gap-2.5"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#27ddeb,#8b5cf6)] text-lg font-bold text-white shadow-[0_12px_30px_rgba(39,221,235,.28)]">
            V
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-semibold tracking-tight text-white">
              Verity
            </span>
            <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-aqua/75">
              Wealth Intelligence
            </span>
          </span>
        </Link>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col px-2.5 py-4" aria-label="Primary">
        <p className="mb-2 px-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
          Workspace
        </p>
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-sm font-semibold transition ${
            pathname === "/"
              ? "bg-white/14 text-white shadow-inner"
              : "text-white/65 hover:bg-white/8 hover:text-white"
          }`}
        >
          <HomeIcon />
          Home
        </Link>

        <button
          type="button"
          onClick={() => setClientsOpen((current) => !current)}
          className={`mt-1 flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-sm font-semibold transition ${
            onClientPage
              ? "bg-white/14 text-white shadow-inner"
              : "text-white/65 hover:bg-white/8 hover:text-white"
          }`}
          aria-expanded={clientsOpen}
        >
          <ClientsIcon />
          <span className="flex-1 text-left">Clients</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className={`h-4 w-4 shrink-0 transition-transform ${clientsOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {clientsOpen && (
          <div className="sidebar-scroll ml-4 mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto border-l border-white/12 py-1 pl-2.5 pr-1">
            {clients.map((client) => {
              const href = `/client/${client.client_id}`;
              const active = pathname === href;
              return (
                <Link
                  key={client.client_id}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`block rounded-xl px-2.5 py-2 text-xs font-medium leading-snug transition ${
                    active
                      ? "bg-aqua/14 text-aqua"
                      : "text-white/52 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  {client.client_name}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link
          href="/profile"
          onClick={() => setMobileOpen(false)}
          className={`flex w-full items-center gap-2.5 rounded-2xl border p-2.5 text-left transition ${
            pathname === "/profile"
              ? "border-white/20 bg-white/14"
              : "border-white/10 bg-white/7 hover:bg-white/12"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f6c453,#ff9f43)] text-xs font-bold text-navy shadow-lg">
            PO
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">
              {displayName}
            </span>
            <span className="block truncate text-[11px] text-white/45">
              Relationship Manager
            </span>
          </span>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-[70] flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 bg-navy/90 text-white shadow-xl backdrop-blur-xl lg:hidden"
        aria-label="Open navigation"
      >
        <span className="text-xl">☰</span>
      </button>

      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[75] bg-navy/45 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[80] w-[16.2rem] border-r border-white/12 bg-[linear-gradient(180deg,rgba(6,26,61,.97),rgba(11,16,32,.95))] shadow-[22px_0_60px_rgba(6,26,61,.18)] backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>
    </>
  );
}
