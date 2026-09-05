"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "./AppSidebar";

interface ShellClient {
  client_id: string;
  client_name: string;
}

interface AppShellProps {
  clients: ShellClient[];
  authenticated: boolean;
  displayName: string;
  children: React.ReactNode;
}

export function AppShell({
  clients,
  authenticated,
  displayName,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (!authenticated && !isLoginPage) {
      router.replace("/login");
    }
  }, [authenticated, isLoginPage, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!authenticated) {
    return null;
  }

  return (
    <>
      <AppSidebar clients={clients} displayName={displayName} />
      <div className="min-h-screen lg:pl-[16.2rem]">{children}</div>
    </>
  );
}
